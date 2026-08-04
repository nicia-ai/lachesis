#define _DARWIN_C_SOURCE 1

#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define M9_PROTOCOL "lachesis-m9b13d-race-resistant-filesystem-helper/1"
#define M9_SEAL "lachesis-m9b13d-sealed/1\n"
#define M9_REAL_ROOT                                                           \
  "/Users/paul/orgs/nicia/lachesis-private/m9b13c-oci-acquisition/v1/"         \
  "docker.io/library/node/24.18.1-bookworm-slim/linux-arm64-v8"
#define M9_PROSPECTIVE_PARENT "/Users/paul/orgs/nicia"
#define M9_PROSPECTIVE_DESTINATION                                             \
  "lachesis-private/m9b13c-oci-acquisition/v1/docker.io/library/node/"         \
  "24.18.1-bookworm-slim/linux-arm64-v8"
#define M9_MAX_COMPONENTS 128
#define M9_MAX_FILES 1024
#define M9_MAX_BYTES 512000000ULL
#define M9_BUFFER_BYTES 65536

typedef struct {
  int fd;
  int parent_fd;
  char name[NAME_MAX + 1];
  dev_t device;
  ino_t inode;
} identity;

typedef struct {
  identity values[M9_MAX_COMPONENTS];
  size_t length;
  char canonical_parent[PATH_MAX];
} identity_chain;

typedef enum { MODE_SYNTHETIC, MODE_PROSPECTIVE } helper_mode;

typedef enum { FAULT_NONE, FAULT_FSYNC, FAULT_SEAL } synthetic_fault;

static int fail_with(int exit_code, const char *reason) {
  (void)fprintf(stderr, "M9B13D_ERROR %s\n", reason);
  return exit_code;
}

static bool starts_with_path(const char *path, const char *prefix) {
  size_t length = strlen(prefix);
  return strncmp(path, prefix, length) == 0 &&
         (path[length] == '\0' || path[length] == '/');
}

static bool safe_component(const char *component) {
  size_t length = strlen(component);
  if (length == 0 || length > NAME_MAX || strcmp(component, ".") == 0 ||
      strcmp(component, "..") == 0) {
    return false;
  }
  for (size_t index = 0; index < length; index += 1) {
    unsigned char byte = (unsigned char)component[index];
    if (byte < 0x21 || byte > 0x7e || byte == '/') {
      return false;
    }
  }
  return true;
}

static bool safe_relative_path(const char *path) {
  if (path[0] == '\0' || path[0] == '/' || strlen(path) >= PATH_MAX) {
    return false;
  }
  char copy[PATH_MAX];
  (void)strcpy(copy, path);
  size_t components = 0;
  char *cursor = copy;
  while (cursor != NULL) {
    char *separator = strchr(cursor, '/');
    if (separator != NULL) {
      *separator = '\0';
    }
    components += 1;
    if (components > M9_MAX_COMPONENTS || !safe_component(cursor)) {
      return false;
    }
    cursor = separator == NULL ? NULL : separator + 1;
  }
  return true;
}

static bool same_stat(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         (left->st_mode & S_IFMT) == (right->st_mode & S_IFMT);
}

static int check_directory_metadata(const struct stat *metadata,
                                    dev_t expected_device) {
  uid_t effective_user = geteuid();
  if (!S_ISDIR(metadata->st_mode)) {
    return fail_with(65, "m9b13d:not-a-directory");
  }
  if (metadata->st_uid != 0 && metadata->st_uid != effective_user) {
    return fail_with(65, "m9b13d:unexpected-ancestor-owner");
  }
  if ((metadata->st_mode & (S_IWGRP | S_IWOTH)) != 0) {
    return fail_with(65, "m9b13d:writable-ancestor");
  }
  if (metadata->st_dev != expected_device) {
    return fail_with(65, "m9b13d:mount-or-device-boundary");
  }
  return 0;
}

static void close_chain(identity_chain *chain) {
  for (size_t index = chain->length; index > 0; index -= 1) {
    (void)close(chain->values[index - 1].fd);
  }
  chain->length = 0;
}

static int append_identity(identity_chain *chain, int fd, int parent_fd,
                           const char *name, const struct stat *metadata) {
  if (chain->length >= M9_MAX_COMPONENTS) {
    return fail_with(65, "m9b13d:ancestor-depth-overflow");
  }
  identity *value = &chain->values[chain->length];
  value->fd = fd;
  value->parent_fd = parent_fd;
  value->device = metadata->st_dev;
  value->inode = metadata->st_ino;
  (void)strcpy(value->name, name);
  chain->length += 1;
  return 0;
}

static int open_ancestor_chain(const char *parent, identity_chain *chain) {
  char resolved[PATH_MAX];
  if (realpath(parent, resolved) == NULL || strcmp(parent, resolved) != 0) {
    return fail_with(65, "m9b13d:noncanonical-or-missing-parent");
  }
  (void)strcpy(chain->canonical_parent, resolved);
  int root_fd = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) {
    return fail_with(67, "m9b13d:root-open-failure");
  }
  struct stat root_metadata;
  if (fstat(root_fd, &root_metadata) != 0) {
    (void)close(root_fd);
    return fail_with(67, "m9b13d:root-stat-failure");
  }
  int result = append_identity(chain, root_fd, -1, "/", &root_metadata);
  if (result != 0) {
    (void)close(root_fd);
    return result;
  }
  char copy[PATH_MAX];
  (void)strcpy(copy, resolved + 1);
  char *cursor = copy;
  int current_fd = root_fd;
  while (cursor[0] != '\0') {
    char *separator = strchr(cursor, '/');
    if (separator != NULL) {
      *separator = '\0';
    }
    if (!safe_component(cursor)) {
      return fail_with(65, "m9b13d:unsafe-ancestor-component");
    }
    struct stat path_metadata;
    if (fstatat(current_fd, cursor, &path_metadata, AT_SYMLINK_NOFOLLOW) != 0 ||
        S_ISLNK(path_metadata.st_mode)) {
      return fail_with(65, "m9b13d:symlinked-or-missing-ancestor");
    }
    int next_fd = openat(current_fd, cursor,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next_fd < 0) {
      return fail_with(65, "m9b13d:ancestor-open-failure");
    }
    struct stat descriptor_metadata;
    if (fstat(next_fd, &descriptor_metadata) != 0 ||
        !same_stat(&path_metadata, &descriptor_metadata)) {
      (void)close(next_fd);
      return fail_with(65, "m9b13d:ancestor-identity-race");
    }
    result =
        check_directory_metadata(&descriptor_metadata, root_metadata.st_dev);
    if (result != 0) {
      (void)close(next_fd);
      return result;
    }
    result = append_identity(chain, next_fd, current_fd, cursor,
                             &descriptor_metadata);
    if (result != 0) {
      (void)close(next_fd);
      return result;
    }
    current_fd = next_fd;
    cursor = separator == NULL ? cursor + strlen(cursor) : separator + 1;
  }
  return 0;
}

static int recheck_chain(const identity_chain *chain) {
  for (size_t index = 0; index < chain->length; index += 1) {
    const identity *value = &chain->values[index];
    struct stat descriptor_metadata;
    if (fstat(value->fd, &descriptor_metadata) != 0 ||
        descriptor_metadata.st_dev != value->device ||
        descriptor_metadata.st_ino != value->inode ||
        !S_ISDIR(descriptor_metadata.st_mode)) {
      return fail_with(65, "m9b13d:descriptor-identity-changed");
    }
    if (index > 0) {
      struct stat path_metadata;
      if (fstatat(value->parent_fd, value->name, &path_metadata,
                  AT_SYMLINK_NOFOLLOW) != 0 ||
          !same_stat(&descriptor_metadata, &path_metadata)) {
        return fail_with(65, "m9b13d:ancestor-or-destination-replaced");
      }
    }
  }
  return 0;
}

static int create_destination(identity_chain *chain, const char *destination,
                              int *root_fd) {
  if (!safe_relative_path(destination)) {
    return fail_with(64, "m9b13d:unsafe-destination-path");
  }
  char combined[PATH_MAX];
  int written = snprintf(combined, sizeof(combined), "%s/%s",
                         chain->canonical_parent, destination);
  if (written < 0 || (size_t)written >= sizeof(combined)) {
    return fail_with(64, "m9b13d:destination-path-overflow");
  }
  const char *forbidden[] = {
      "/Users/paul/orgs/nicia/lachesis",
      "/Users/paul/orgs/nicia/lachesis/sealed",
      "/Users/paul/orgs/nicia/lachesis/paper",
  };
  for (size_t index = 0; index < sizeof(forbidden) / sizeof(forbidden[0]);
       index += 1) {
    if (starts_with_path(combined, forbidden[index])) {
      return fail_with(65, "m9b13d:forbidden-destination-root");
    }
  }
  int current_fd = chain->values[chain->length - 1].fd;
  char copy[PATH_MAX];
  (void)strcpy(copy, destination);
  char *cursor = copy;
  while (cursor != NULL) {
    char *separator = strchr(cursor, '/');
    if (separator != NULL) {
      *separator = '\0';
    }
    int result = recheck_chain(chain);
    if (result != 0) {
      return result;
    }
    if (mkdirat(current_fd, cursor, 0700) != 0) {
      return fail_with(errno == EEXIST ? 66 : 67,
                       errno == EEXIST ? "m9b13d:destination-already-exists"
                                       : "m9b13d:destination-create-failure");
    }
    int next_fd = openat(current_fd, cursor,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next_fd < 0) {
      return fail_with(67, "m9b13d:created-destination-open-failure");
    }
    if (fsync(current_fd) != 0) {
      (void)close(next_fd);
      return fail_with(67, "m9b13d:destination-parent-fsync-failure");
    }
    struct stat metadata;
    if (fstat(next_fd, &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
        metadata.st_uid != geteuid() || (metadata.st_mode & 0777) != 0700 ||
        metadata.st_nlink < 2) {
      (void)close(next_fd);
      return fail_with(65, "m9b13d:created-destination-metadata-mismatch");
    }
    result = append_identity(chain, next_fd, current_fd, cursor, &metadata);
    if (result != 0) {
      (void)close(next_fd);
      return result;
    }
    result = recheck_chain(chain);
    if (result != 0) {
      return result;
    }
    current_fd = next_fd;
    cursor = separator == NULL ? NULL : separator + 1;
  }
  *root_fd = current_fd;
  return recheck_chain(chain);
}

static int hex_value(char byte) {
  if (byte >= '0' && byte <= '9') {
    return byte - '0';
  }
  if (byte >= 'a' && byte <= 'f') {
    return byte - 'a' + 10;
  }
  return -1;
}

static bool decode_hex_path(const char *encoded, char *output,
                            size_t output_bytes) {
  size_t length = strlen(encoded);
  if (length == 0 || length % 2 != 0 || length / 2 >= output_bytes) {
    return false;
  }
  for (size_t index = 0; index < length; index += 2) {
    int high = hex_value(encoded[index]);
    int low = hex_value(encoded[index + 1]);
    if (high < 0 || low < 0) {
      return false;
    }
    output[index / 2] = (char)((high << 4) | low);
    if (output[index / 2] == '\0') {
      return false;
    }
  }
  output[length / 2] = '\0';
  return safe_relative_path(output);
}

static bool parse_uint64(const char *text, uint64_t *value) {
  if (text[0] == '\0') {
    return false;
  }
  uint64_t result = 0;
  for (size_t index = 0; text[index] != '\0'; index += 1) {
    if (text[index] < '0' || text[index] > '9') {
      return false;
    }
    uint64_t digit = (uint64_t)(text[index] - '0');
    if (result > (UINT64_MAX - digit) / 10) {
      return false;
    }
    result = result * 10 + digit;
  }
  *value = result;
  return true;
}

static int open_or_create_directory(identity_chain *chain, int parent_fd,
                                    const char *name, dev_t expected_device,
                                    int *result_fd) {
  int result = recheck_chain(chain);
  if (result != 0) {
    return result;
  }
  struct stat parent_before;
  if (fstat(parent_fd, &parent_before) != 0 ||
      !S_ISDIR(parent_before.st_mode)) {
    return fail_with(65, "m9b13d:file-parent-identity-failure");
  }
  int fd =
      openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  bool created = false;
  if (fd < 0 && errno == ENOENT) {
    if (mkdirat(parent_fd, name, 0700) != 0) {
      return fail_with(67, "m9b13d:file-directory-create-failure");
    }
    created = true;
    fd = openat(parent_fd, name,
                O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  if (fd < 0) {
    return fail_with(65, "m9b13d:file-directory-open-failure");
  }
  struct stat metadata;
  if (fstat(fd, &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
      metadata.st_uid != geteuid() || metadata.st_dev != expected_device ||
      (metadata.st_mode & (S_IWGRP | S_IWOTH)) != 0) {
    (void)close(fd);
    return fail_with(65, "m9b13d:file-directory-metadata-mismatch");
  }
  struct stat parent_after;
  if (fstat(parent_fd, &parent_after) != 0 ||
      !same_stat(&parent_before, &parent_after)) {
    (void)close(fd);
    return fail_with(65, "m9b13d:file-parent-replaced");
  }
  if (created && fsync(parent_fd) != 0) {
    (void)close(fd);
    return fail_with(67, "m9b13d:file-directory-fsync-failure");
  }
  result = recheck_chain(chain);
  if (result != 0) {
    (void)close(fd);
    return result;
  }
  *result_fd = fd;
  return 0;
}

static int open_file_parent(identity_chain *chain, int root_fd,
                            const char *path, dev_t expected_device,
                            int *parent_fd, char *leaf) {
  char copy[PATH_MAX];
  (void)strcpy(copy, path);
  char *last = strrchr(copy, '/');
  if (last == NULL) {
    (void)strcpy(leaf, copy);
    *parent_fd = dup(root_fd);
    return *parent_fd < 0 ? fail_with(67, "m9b13d:root-dup-failure") : 0;
  }
  *last = '\0';
  (void)strcpy(leaf, last + 1);
  int current_fd = dup(root_fd);
  if (current_fd < 0) {
    return fail_with(67, "m9b13d:root-dup-failure");
  }
  char *cursor = copy;
  while (cursor != NULL) {
    char *separator = strchr(cursor, '/');
    if (separator != NULL) {
      *separator = '\0';
    }
    int next_fd = -1;
    int result = open_or_create_directory(chain, current_fd, cursor,
                                          expected_device, &next_fd);
    (void)close(current_fd);
    if (result != 0) {
      return result;
    }
    current_fd = next_fd;
    cursor = separator == NULL ? NULL : separator + 1;
  }
  *parent_fd = current_fd;
  return 0;
}

static int verify_file_parent_path(int root_fd, const char *path,
                                   int expected_parent_fd) {
  char copy[PATH_MAX];
  (void)strcpy(copy, path);
  char *last = strrchr(copy, '/');
  int current_fd = dup(root_fd);
  if (current_fd < 0) {
    return fail_with(67, "m9b13d:root-dup-failure");
  }
  if (last != NULL) {
    *last = '\0';
    char *cursor = copy;
    while (cursor != NULL) {
      char *separator = strchr(cursor, '/');
      if (separator != NULL) {
        *separator = '\0';
      }
      int next_fd = openat(current_fd, cursor,
                           O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      (void)close(current_fd);
      if (next_fd < 0) {
        return fail_with(65, "m9b13d:file-parent-path-replaced");
      }
      current_fd = next_fd;
      cursor = separator == NULL ? NULL : separator + 1;
    }
  }
  struct stat path_metadata;
  struct stat descriptor_metadata;
  int result = 0;
  if (fstat(current_fd, &path_metadata) != 0 ||
      fstat(expected_parent_fd, &descriptor_metadata) != 0 ||
      !same_stat(&path_metadata, &descriptor_metadata) ||
      !S_ISDIR(descriptor_metadata.st_mode)) {
    result = fail_with(65, "m9b13d:file-parent-path-replaced");
  }
  (void)close(current_fd);
  return result;
}

static int recheck_file_context(const identity_chain *chain, int root_fd,
                                const char *path, int parent_fd) {
  int result = recheck_chain(chain);
  if (result != 0) {
    return result;
  }
  return verify_file_parent_path(root_fd, path, parent_fd);
}

static void digest_hex(const unsigned char digest[CC_SHA256_DIGEST_LENGTH],
                       char output[CC_SHA256_DIGEST_LENGTH * 2 + 1]) {
  static const char alphabet[] = "0123456789abcdef";
  for (size_t index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    output[index * 2] = alphabet[digest[index] >> 4];
    output[index * 2 + 1] = alphabet[digest[index] & 0x0f];
  }
  output[CC_SHA256_DIGEST_LENGTH * 2] = '\0';
}

static int write_file_transaction(identity_chain *chain, int root_fd,
                                  const char *path, uint64_t size,
                                  const char *expected_digest,
                                  uint64_t file_ordinal,
                                  synthetic_fault fault) {
  int result = recheck_chain(chain);
  if (result != 0) {
    return result;
  }
  char leaf[NAME_MAX + 1];
  int parent_fd = -1;
  result = open_file_parent(chain, root_fd, path,
                            chain->values[chain->length - 1].device, &parent_fd,
                            leaf);
  if (result != 0) {
    return result;
  }
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(parent_fd);
    return result;
  }
  struct stat collision;
  if (fstatat(parent_fd, leaf, &collision, AT_SYMLINK_NOFOLLOW) == 0 ||
      errno != ENOENT) {
    (void)close(parent_fd);
    return fail_with(66, "m9b13d:file-rename-collision");
  }
  char temporary[NAME_MAX + 1];
  int name_bytes = snprintf(temporary, sizeof(temporary), ".m9b13d.tmp.%llu",
                            (unsigned long long)file_ordinal);
  if (name_bytes < 0 || (size_t)name_bytes >= sizeof(temporary)) {
    (void)close(parent_fd);
    return fail_with(67, "m9b13d:temporary-name-overflow");
  }
  int file_fd =
      openat(parent_fd, temporary,
             O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (file_fd < 0) {
    (void)close(parent_fd);
    return fail_with(66, "m9b13d:temporary-create-collision");
  }
  CC_SHA256_CTX hash;
  (void)CC_SHA256_Init(&hash);
  unsigned char buffer[M9_BUFFER_BYTES];
  uint64_t remaining = size;
  while (remaining > 0) {
    result = recheck_file_context(chain, root_fd, path, parent_fd);
    if (result != 0) {
      (void)close(file_fd);
      (void)close(parent_fd);
      return result;
    }
    size_t wanted =
        remaining > sizeof(buffer) ? sizeof(buffer) : (size_t)remaining;
    size_t received = fread(buffer, 1, wanted, stdin);
    if (received != wanted) {
      (void)close(file_fd);
      (void)close(parent_fd);
      return fail_with(67, "m9b13d:partial-input-write");
    }
    (void)CC_SHA256_Update(&hash, buffer, (CC_LONG)received);
    size_t offset = 0;
    while (offset < received) {
      ssize_t count = write(file_fd, buffer + offset, received - offset);
      if (count <= 0) {
        (void)close(file_fd);
        (void)close(parent_fd);
        return fail_with(67, "m9b13d:file-write-failure");
      }
      offset += (size_t)count;
    }
    result = recheck_file_context(chain, root_fd, path, parent_fd);
    if (result != 0) {
      (void)close(file_fd);
      (void)close(parent_fd);
      return result;
    }
    remaining -= received;
  }
  int separator = fgetc(stdin);
  if (separator != '\n') {
    (void)close(file_fd);
    (void)close(parent_fd);
    return fail_with(67, "m9b13d:missing-file-frame-terminator");
  }
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  (void)CC_SHA256_Final(digest, &hash);
  char actual_digest[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  digest_hex(digest, actual_digest);
  if (strcmp(expected_digest, actual_digest) != 0) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return fail_with(65, "m9b13d:file-digest-mismatch");
  }
  struct stat metadata;
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return result;
  }
  if (fstat(file_fd, &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
      metadata.st_uid != geteuid() || metadata.st_nlink != 1 ||
      metadata.st_size != (off_t)size ||
      metadata.st_dev != chain->values[chain->length - 1].device) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return fail_with(65, "m9b13d:file-metadata-mismatch");
  }
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return result;
  }
  if (fault == FAULT_FSYNC || fsync(file_fd) != 0) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return fail_with(67, "m9b13d:file-fsync-failure");
  }
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(file_fd);
    (void)close(parent_fd);
    return result;
  }
  if (close(file_fd) != 0) {
    (void)close(parent_fd);
    return fail_with(67, "m9b13d:file-close-failure");
  }
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(parent_fd);
    return result;
  }
  if (renameatx_np(parent_fd, temporary, parent_fd, leaf, RENAME_EXCL) != 0) {
    (void)close(parent_fd);
    return fail_with(66, "m9b13d:file-rename-collision");
  }
  if (fsync(parent_fd) != 0) {
    (void)close(parent_fd);
    return fail_with(67, "m9b13d:directory-fsync-failure");
  }
  result = recheck_file_context(chain, root_fd, path, parent_fd);
  if (result != 0) {
    (void)close(parent_fd);
    return result;
  }
  (void)close(parent_fd);
  return recheck_chain(chain);
}

static int seal_transaction(identity_chain *chain, int root_fd,
                            synthetic_fault fault) {
  int result = recheck_chain(chain);
  if (result != 0) {
    return result;
  }
  if (fault == FAULT_SEAL) {
    return fail_with(67, "m9b13d:seal-failure");
  }
  int seal_fd =
      openat(root_fd, ".m9b13d-sealed",
             O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (seal_fd < 0) {
    return fail_with(66, "m9b13d:seal-collision");
  }
  result = recheck_chain(chain);
  if (result != 0) {
    (void)close(seal_fd);
    return result;
  }
  const char *content = M9_SEAL;
  size_t length = strlen(content);
  if (write(seal_fd, content, length) != (ssize_t)length ||
      fsync(seal_fd) != 0) {
    (void)close(seal_fd);
    return fail_with(67, "m9b13d:seal-write-or-fsync-failure");
  }
  result = recheck_chain(chain);
  if (result != 0) {
    (void)close(seal_fd);
    return result;
  }
  struct stat metadata;
  if (fstat(seal_fd, &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
      metadata.st_nlink != 1 || metadata.st_size != (off_t)length) {
    (void)close(seal_fd);
    return fail_with(65, "m9b13d:seal-metadata-mismatch");
  }
  if (close(seal_fd) != 0 || fsync(root_fd) != 0) {
    return fail_with(67, "m9b13d:seal-close-or-root-fsync-failure");
  }
  return recheck_chain(chain);
}

static int run_transaction(helper_mode mode, const char *parent,
                           const char *destination, synthetic_fault fault) {
  if (mode == MODE_PROSPECTIVE &&
      (strcmp(parent, M9_PROSPECTIVE_PARENT) != 0 ||
       strcmp(destination, M9_PROSPECTIVE_DESTINATION) != 0)) {
    return fail_with(64, "m9b13d:prospective-root-mismatch");
  }
  if (mode == MODE_SYNTHETIC) {
    char combined[PATH_MAX];
    int bytes =
        snprintf(combined, sizeof(combined), "%s/%s", parent, destination);
    if (bytes < 0 || (size_t)bytes >= sizeof(combined) ||
        starts_with_path(combined, M9_REAL_ROOT)) {
      return fail_with(65, "m9b13d:real-root-forbidden-in-synthetic-mode");
    }
  } else if (fault != FAULT_NONE) {
    return fail_with(64, "m9b13d:synthetic-fault-forbidden");
  }
  identity_chain chain = {0};
  int result = open_ancestor_chain(parent, &chain);
  if (result != 0) {
    close_chain(&chain);
    return result;
  }
  int root_fd = -1;
  result = create_destination(&chain, destination, &root_fd);
  if (result != 0) {
    close_chain(&chain);
    return result;
  }
  uint64_t files = 0;
  uint64_t bytes = 0;
  bool sealed = false;
  char *line = NULL;
  size_t capacity = 0;
  while (getline(&line, &capacity, stdin) >= 0) {
    size_t line_length = strlen(line);
    if (line_length == 0 || line[line_length - 1] != '\n') {
      result = fail_with(64, "m9b13d:malformed-command-frame");
      break;
    }
    line[line_length - 1] = '\0';
    if (strcmp(line, "SEAL") == 0) {
      result = seal_transaction(&chain, root_fd, fault);
      if (result == 0 && fgetc(stdin) != EOF) {
        result = fail_with(65, "m9b13d:post-seal-mutation-attempt");
      }
      if (result == 0) {
        sealed = true;
        (void)printf("{\"protocol\":\"%s\",\"status\":\"sealed\",\"files\":%"
                     "llu,\"bytes\":%llu}\n",
                     M9_PROTOCOL, (unsigned long long)files,
                     (unsigned long long)bytes);
      }
      break;
    }
    char *save = NULL;
    char *command = strtok_r(line, " ", &save);
    char *encoded_path = strtok_r(NULL, " ", &save);
    char *size_text = strtok_r(NULL, " ", &save);
    char *digest = strtok_r(NULL, " ", &save);
    if (command == NULL || strcmp(command, "FILE") != 0 ||
        encoded_path == NULL || size_text == NULL || digest == NULL ||
        strtok_r(NULL, " ", &save) != NULL || strlen(digest) != 64) {
      result = fail_with(64, "m9b13d:malformed-file-command");
      break;
    }
    for (size_t index = 0; index < 64; index += 1) {
      if (hex_value(digest[index]) < 0) {
        result = fail_with(64, "m9b13d:malformed-file-digest");
        break;
      }
    }
    if (result != 0) {
      break;
    }
    char path[PATH_MAX];
    uint64_t size = 0;
    if (!decode_hex_path(encoded_path, path, sizeof(path)) ||
        !parse_uint64(size_text, &size)) {
      result = fail_with(64, "m9b13d:malformed-file-path-or-size");
      break;
    }
    files += 1;
    if (files > M9_MAX_FILES || size > M9_MAX_BYTES - bytes) {
      result = fail_with(65, "m9b13d:file-or-byte-limit-overflow");
      break;
    }
    bytes += size;
    result = write_file_transaction(&chain, root_fd, path, size, digest, files,
                                    fault);
    if (result != 0) {
      break;
    }
  }
  if (result == 0 && !sealed) {
    result = fail_with(67, "m9b13d:input-ended-before-seal");
  }
  free(line);
  close_chain(&chain);
  return result;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--identity") == 0) {
    (void)printf("{\"protocol\":\"%s\",\"platform\":\"arm64-apple-darwin25.5."
                 "0\",\"network\":false}\n",
                 M9_PROTOCOL);
    return 0;
  }
  if (argc != 7 || strcmp(argv[1], "--mode") != 0 ||
      strcmp(argv[3], "--parent") != 0 ||
      strcmp(argv[5], "--destination") != 0) {
    return fail_with(64, "m9b13d:invalid-arguments");
  }
  helper_mode mode;
  synthetic_fault fault = FAULT_NONE;
  char *mode_separator = strchr(argv[2], ':');
  if (mode_separator != NULL) {
    *mode_separator = '\0';
    const char *fault_name = mode_separator + 1;
    if (strcmp(fault_name, "fsync") == 0) {
      fault = FAULT_FSYNC;
    } else if (strcmp(fault_name, "seal") == 0) {
      fault = FAULT_SEAL;
    } else {
      return fail_with(64, "m9b13d:unknown-synthetic-fault");
    }
  }
  if (strcmp(argv[2], "synthetic") == 0) {
    mode = MODE_SYNTHETIC;
  } else if (strcmp(argv[2], "prospective") == 0) {
    mode = MODE_PROSPECTIVE;
  } else {
    return fail_with(64, "m9b13d:unknown-mode");
  }
  return run_transaction(mode, argv[4], argv[6], fault);
}
