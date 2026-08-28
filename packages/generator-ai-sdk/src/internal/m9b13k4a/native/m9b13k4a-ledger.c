#define _DARWIN_C_SOURCE 1

#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define LOG_HEADER_SIZE 64U
#define RECORD_HEADER_SIZE 56U
#define RECORD_TRAILER_SIZE 40U
#define MAX_PAYLOAD_SIZE 65536U
#define MAX_LOG_SIZE (8U * 1024U * 1024U)

static const uint8_t LOG_MAGIC[8] = {'L', '9', 'K', '4', 'L', 'O', 'G', '1'};
static const uint8_t RECORD_MAGIC[4] = {'R', 'E', 'C', '4'};
static const uint8_t FOOTER_MAGIC[4] = {'E', 'N', 'D', '4'};
static const uint8_t ZERO_RESERVED[12] = {0};

struct admitted_namespace {
  int parent_parent_fd;
  int parent_fd;
  int directory_fd;
  char parent_leaf[256];
  char leaf[256];
  char path[4096];
  struct stat parent_stat;
  struct stat directory_stat;
};

static int forced_eintr_consumed = 0;

static void ignore_signal(int signal_number) { (void)signal_number; }

static int inject_eintr(const char *point) {
  const char *selected = getenv("M9B13K4A_EINTR_POINT");
  if (forced_eintr_consumed || selected == NULL || strcmp(selected, point) != 0)
    return 0;
  forced_eintr_consumed = 1;
  (void)raise(SIGUSR1);
  errno = EINTR;
  return 1;
}

static int full_write_at_point(int fd, const uint8_t *source, size_t length,
                               const char *point) {
  size_t completed = 0U;
  while (completed < length) {
    ssize_t amount;
    if (inject_eintr(point))
      amount = -1;
    else
      amount = write(fd, source + completed, length - completed);
    if (amount < 0 && errno == EINTR)
      continue;
    if (amount <= 0)
      return -1;
    completed += (size_t)amount;
  }
  return 0;
}

struct ledger_state {
  uint8_t session[32];
  uint64_t sequence;
  uint8_t root[32];
  off_t valid_size;
};

static void put_u32(uint8_t *target, uint32_t value) {
  target[0] = (uint8_t)(value >> 24U);
  target[1] = (uint8_t)(value >> 16U);
  target[2] = (uint8_t)(value >> 8U);
  target[3] = (uint8_t)value;
}

static void put_u64(uint8_t *target, uint64_t value) {
  for (size_t index = 0; index < 8U; index++)
    target[index] = (uint8_t)(value >> (56U - (index * 8U)));
}

static uint32_t get_u32(const uint8_t *source) {
  return ((uint32_t)source[0] << 24U) | ((uint32_t)source[1] << 16U) |
         ((uint32_t)source[2] << 8U) | (uint32_t)source[3];
}

static uint64_t get_u64(const uint8_t *source) {
  uint64_t value = 0U;
  for (size_t index = 0; index < 8U; index++)
    value = (value << 8U) | source[index];
  return value;
}

static uint32_t crc32_bytes(const uint8_t *bytes, size_t length) {
  uint32_t value = UINT32_MAX;
  for (size_t index = 0; index < length; index++) {
    value ^= bytes[index];
    for (unsigned bit = 0; bit < 8U; bit++)
      value = (value >> 1U) ^ (0xedb88320U & (0U - (value & 1U)));
  }
  return ~value;
}

static void sha256_bytes(const uint8_t *bytes, size_t length,
                         uint8_t output[32]) {
  (void)CC_SHA256(bytes, (CC_LONG)length, output);
}

static void hex_encode(const uint8_t *bytes, size_t length, char *output) {
  static const char alphabet[] = "0123456789abcdef";
  for (size_t index = 0; index < length; index++) {
    output[index * 2U] = alphabet[bytes[index] >> 4U];
    output[(index * 2U) + 1U] = alphabet[bytes[index] & 0x0fU];
  }
  output[length * 2U] = '\0';
}

static int hex_decode_32(const char *source, uint8_t output[32]) {
  if (strlen(source) != 64U)
    return -1;
  for (size_t index = 0; index < 32U; index++) {
    unsigned value = 0U;
    for (size_t half = 0; half < 2U; half++) {
      const char character = source[(index * 2U) + half];
      unsigned nibble;
      if (character >= '0' && character <= '9')
        nibble = (unsigned)(character - '0');
      else if (character >= 'a' && character <= 'f')
        nibble = (unsigned)(character - 'a') + 10U;
      else
        return -1;
      value = (value << 4U) | nibble;
    }
    output[index] = (uint8_t)value;
  }
  return 0;
}

static void fail(const char *code, int ambiguous) {
  char output[96];
  const int length =
      snprintf(output, sizeof(output), "ERR %s %d\n", code, ambiguous);
  if (length > 0 && (size_t)length < sizeof(output))
    (void)full_write_at_point(STDOUT_FILENO, (const uint8_t *)output,
                              (size_t)length, "response-write");
}

static int exact_mode(const struct stat *value, mode_t mode) {
  return (value->st_mode & 07777U) == mode;
}

static int valid_owned_directory(const struct stat *value, mode_t mode) {
  return S_ISDIR(value->st_mode) && value->st_uid == geteuid() &&
         exact_mode(value, mode) && value->st_nlink >= 2;
}

static int valid_owned_log(const struct stat *value) {
  return S_ISREG(value->st_mode) && value->st_uid == geteuid() &&
         exact_mode(value, 0600) && value->st_nlink == 1;
}

static int approved_sticky_system_ancestor(char components[][256], size_t index,
                                           const struct stat *value) {
  return index == 1U && strcmp(components[0], "private") == 0 &&
         strcmp(components[1], "tmp") == 0 && value->st_uid == 0 &&
         exact_mode(value, 01777);
}

static int valid_ancestor(const struct stat *value, char components[][256],
                          size_t index) {
  if (!S_ISDIR(value->st_mode) || value->st_nlink < 2)
    return 0;
  if (value->st_uid == geteuid())
    return exact_mode(value, 0700);
  if (value->st_uid != 0)
    return 0;
  const mode_t writable = value->st_mode & 0022U;
  return writable == 0 ||
         approved_sticky_system_ancestor(components, index, value);
}

static int split_path(const char *path, char components[][256], size_t *count) {
  const size_t length = strlen(path);
  if (length < 2U || length >= 4096U || path[0] != '/' ||
      path[length - 1U] == '/')
    return -1;
  *count = 0U;
  size_t start = 1U;
  while (start < length) {
    size_t end = start;
    while (end < length && path[end] != '/')
      end++;
    const size_t component_length = end - start;
    if (component_length == 0U || component_length >= 256U ||
        (component_length == 1U && path[start] == '.') ||
        (component_length == 2U && path[start] == '.' &&
         path[start + 1U] == '.') ||
        *count >= 64U)
      return -1;
    (void)memcpy(components[*count], path + start, component_length);
    components[*count][component_length] = '\0';
    (*count)++;
    start = end + 1U;
  }
  return *count == 0U ? -1 : 0;
}

static int walk_to_parent(const char *path, int *parent_parent_fd,
                          char parent_leaf[256], int *parent_fd, char leaf[256],
                          struct stat *parent_stat) {
  char components[64][256];
  size_t count = 0U;
  if (split_path(path, components, &count) != 0)
    return -1;
  int current = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (current < 0)
    return -1;
  *parent_parent_fd = -1;
  for (size_t index = 0; index + 1U < count; index++) {
    struct stat before;
    if (fstatat(current, components[index], &before, AT_SYMLINK_NOFOLLOW) !=
            0 ||
        !valid_ancestor(&before, components, index)) {
      (void)close(current);
      return -1;
    }
    int next = openat(current, components[index],
                      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) {
      (void)close(current);
      return -1;
    }
    struct stat after;
    if (fstat(next, &after) != 0 || before.st_dev != after.st_dev ||
        before.st_ino != after.st_ino || !S_ISDIR(after.st_mode)) {
      (void)close(next);
      (void)close(current);
      return -1;
    }
    if (index + 2U == count) {
      *parent_parent_fd = current;
      (void)strcpy(parent_leaf, components[index]);
    } else {
      (void)close(current);
    }
    current = next;
  }
  if (*parent_parent_fd < 0 || fstat(current, parent_stat) != 0) {
    if (*parent_parent_fd >= 0)
      (void)close(*parent_parent_fd);
    (void)close(current);
    return -1;
  }
  (void)strcpy(leaf, components[count - 1U]);
  *parent_fd = current;
  return 0;
}

static int admit_namespace(const char *path, int create,
                           struct admitted_namespace *admitted) {
  if (strlen(path) >= sizeof(admitted->path))
    return -1;
  (void)strcpy(admitted->path, path);
  if (walk_to_parent(path, &admitted->parent_parent_fd, admitted->parent_leaf,
                     &admitted->parent_fd, admitted->leaf,
                     &admitted->parent_stat) != 0)
    return -1;
  if (!valid_owned_directory(&admitted->parent_stat, 0700)) {
    (void)close(admitted->parent_parent_fd);
    (void)close(admitted->parent_fd);
    return -1;
  }
  if (create) {
    struct stat existing;
    if (fstatat(admitted->parent_fd, admitted->leaf, &existing,
                AT_SYMLINK_NOFOLLOW) == 0 ||
        errno != ENOENT ||
        mkdirat(admitted->parent_fd, admitted->leaf, 0700) != 0) {
      (void)close(admitted->parent_fd);
      (void)close(admitted->parent_parent_fd);
      return -1;
    }
  }
  struct stat before;
  if (fstatat(admitted->parent_fd, admitted->leaf, &before,
              AT_SYMLINK_NOFOLLOW) != 0 ||
      !valid_owned_directory(&before, 0700)) {
    (void)close(admitted->parent_fd);
    (void)close(admitted->parent_parent_fd);
    return -1;
  }
  admitted->directory_fd =
      openat(admitted->parent_fd, admitted->leaf,
             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (admitted->directory_fd < 0 ||
      fstat(admitted->directory_fd, &admitted->directory_stat) != 0 ||
      before.st_dev != admitted->directory_stat.st_dev ||
      before.st_ino != admitted->directory_stat.st_ino ||
      !valid_owned_directory(&admitted->directory_stat, 0700)) {
    if (admitted->directory_fd >= 0)
      (void)close(admitted->directory_fd);
    (void)close(admitted->parent_fd);
    (void)close(admitted->parent_parent_fd);
    return -1;
  }
  return 0;
}

static int path_chain_still_safe(const struct admitted_namespace *admitted) {
  int parent_parent_fd = -1;
  int parent_fd = -1;
  char parent_leaf[256];
  char leaf[256];
  struct stat parent_stat;
  if (walk_to_parent(admitted->path, &parent_parent_fd, parent_leaf, &parent_fd,
                     leaf, &parent_stat) != 0)
    return 0;
  const int valid = strcmp(parent_leaf, admitted->parent_leaf) == 0 &&
                    strcmp(leaf, admitted->leaf) == 0 &&
                    parent_stat.st_dev == admitted->parent_stat.st_dev &&
                    parent_stat.st_ino == admitted->parent_stat.st_ino &&
                    valid_owned_directory(&parent_stat, 0700);
  (void)close(parent_fd);
  (void)close(parent_parent_fd);
  return valid;
}

static int namespace_still_pinned(const struct admitted_namespace *admitted) {
  struct stat parent_path_stat;
  struct stat parent_descriptor_stat;
  struct stat path_stat;
  struct stat descriptor_stat;
  return path_chain_still_safe(admitted) &&
         fstatat(admitted->parent_parent_fd, admitted->parent_leaf,
                 &parent_path_stat, AT_SYMLINK_NOFOLLOW) == 0 &&
         fstat(admitted->parent_fd, &parent_descriptor_stat) == 0 &&
         parent_path_stat.st_dev == parent_descriptor_stat.st_dev &&
         parent_path_stat.st_ino == parent_descriptor_stat.st_ino &&
         parent_descriptor_stat.st_dev == admitted->parent_stat.st_dev &&
         parent_descriptor_stat.st_ino == admitted->parent_stat.st_ino &&
         valid_owned_directory(&parent_descriptor_stat, 0700) &&
         fstatat(admitted->parent_fd, admitted->leaf, &path_stat,
                 AT_SYMLINK_NOFOLLOW) == 0 &&
         fstat(admitted->directory_fd, &descriptor_stat) == 0 &&
         path_stat.st_dev == descriptor_stat.st_dev &&
         path_stat.st_ino == descriptor_stat.st_ino &&
         descriptor_stat.st_dev == admitted->directory_stat.st_dev &&
         descriptor_stat.st_ino == admitted->directory_stat.st_ino &&
         valid_owned_directory(&descriptor_stat, 0700);
}

static void close_admitted(struct admitted_namespace *admitted) {
  (void)close(admitted->directory_fd);
  (void)close(admitted->parent_fd);
  (void)close(admitted->parent_parent_fd);
}

static int full_pread(int fd, uint8_t *target, size_t length, off_t offset) {
  size_t completed = 0U;
  while (completed < length) {
    ssize_t amount;
    if (inject_eintr("pread"))
      amount = -1;
    else
      amount = pread(fd, target + completed, length - completed,
                     offset + (off_t)completed);
    if (amount < 0 && errno == EINTR)
      continue;
    if (amount <= 0)
      return -1;
    completed += (size_t)amount;
  }
  return 0;
}

static int retry_fsync(int fd) {
  for (;;) {
    int result;
    if (inject_eintr("fsync"))
      result = -1;
    else
      result = fsync(fd);
    if (result == 0)
      return 0;
    if (errno != EINTR)
      return -1;
  }
}

static int retry_flock(int fd, int operation) {
  for (;;) {
    int result;
    if (inject_eintr("flock"))
      result = -1;
    else
      result = flock(fd, operation);
    if (result == 0)
      return 0;
    if (errno != EINTR)
      return -1;
  }
}

static int validate_log(int fd, struct ledger_state *state, int *ambiguous) {
  struct stat descriptor;
  *ambiguous = 0;
  if (fstat(fd, &descriptor) != 0 || !valid_owned_log(&descriptor) ||
      descriptor.st_size < (off_t)LOG_HEADER_SIZE ||
      descriptor.st_size > (off_t)MAX_LOG_SIZE)
    return -1;
  uint8_t header[LOG_HEADER_SIZE];
  if (full_pread(fd, header, sizeof(header), 0) != 0 ||
      memcmp(header, LOG_MAGIC, sizeof(LOG_MAGIC)) != 0 ||
      get_u32(header + 8U) != 1U || get_u32(header + 12U) != LOG_HEADER_SIZE ||
      memcmp(header + 48U, ZERO_RESERVED, sizeof(ZERO_RESERVED)) != 0 ||
      crc32_bytes(header, 60U) != get_u32(header + 60U))
    return -1;
  (void)memcpy(state->session, header + 16U, 32U);
  state->sequence = 0U;
  sha256_bytes(header, sizeof(header), state->root);
  off_t offset = (off_t)LOG_HEADER_SIZE;
  while (offset < descriptor.st_size) {
    const off_t remaining = descriptor.st_size - offset;
    if (remaining < (off_t)(RECORD_HEADER_SIZE + RECORD_TRAILER_SIZE)) {
      *ambiguous = 1;
      return -1;
    }
    uint8_t record_header[RECORD_HEADER_SIZE];
    if (full_pread(fd, record_header, sizeof(record_header), offset) != 0 ||
        memcmp(record_header, RECORD_MAGIC, 4U) != 0 ||
        get_u32(record_header + 4U) != 1U)
      return -1;
    const uint32_t total = get_u32(record_header + 8U);
    const uint32_t payload_length = get_u32(record_header + 12U);
    if (payload_length > MAX_PAYLOAD_SIZE ||
        total != RECORD_HEADER_SIZE + payload_length + RECORD_TRAILER_SIZE ||
        (off_t)total > remaining) {
      *ambiguous = (off_t)total > remaining;
      return -1;
    }
    uint8_t *record = malloc(total);
    if (record == NULL || full_pread(fd, record, total, offset) != 0) {
      free(record);
      return -1;
    }
    uint8_t digest[32];
    sha256_bytes(record, RECORD_HEADER_SIZE + payload_length, digest);
    const size_t digest_offset = RECORD_HEADER_SIZE + payload_length;
    const uint32_t expected_crc = crc32_bytes(record, digest_offset + 32U);
    const int valid =
        get_u64(record_header + 16U) == state->sequence + 1U &&
        memcmp(record_header + 24U, state->root, 32U) == 0 &&
        memcmp(digest, record + digest_offset, 32U) == 0 &&
        expected_crc == get_u32(record + digest_offset + 32U) &&
        memcmp(record + digest_offset + 36U, FOOTER_MAGIC, 4U) == 0;
    if (!valid) {
      free(record);
      return -1;
    }
    state->sequence++;
    (void)memcpy(state->root, digest, 32U);
    offset += (off_t)total;
    free(record);
  }
  state->valid_size = offset;
  return 0;
}

static void maybe_crash(const char *point) {
  const char *selected = getenv("M9B13K4A_CRASH_POINT");
  if (selected != NULL && strcmp(selected, point) == 0)
    _exit(91);
}

static int barrier(void) {
  const char *enabled = getenv("M9B13K4A_BARRIER");
  if (enabled == NULL || strcmp(enabled, "1") != 0)
    return 0;
  if (full_write_at_point(3, (const uint8_t *)"R", 1U, "barrier-write") != 0)
    return -1;
  char release;
  for (;;) {
    ssize_t amount;
    if (inject_eintr("barrier-read"))
      amount = -1;
    else
      amount = read(4, &release, 1U);
    if (amount < 0 && errno == EINTR)
      continue;
    return amount == 1 ? 0 : -1;
  }
}

static int print_state(const char *operation,
                       const struct admitted_namespace *admitted,
                       const struct stat *log_stat,
                       const struct ledger_state *state) {
  char session[65];
  char root[65];
  char output[320];
  hex_encode(state->session, 32U, session);
  hex_encode(state->root, 32U, root);
  const int length =
      snprintf(output, sizeof(output), "OK %s %s %llu %s %llu %llu %llu %llu\n",
               operation, session, (unsigned long long)state->sequence, root,
               (unsigned long long)admitted->directory_stat.st_dev,
               (unsigned long long)admitted->directory_stat.st_ino,
               (unsigned long long)log_stat->st_dev,
               (unsigned long long)log_stat->st_ino);
  return length > 0 && (size_t)length < sizeof(output) &&
                 full_write_at_point(STDOUT_FILENO, (const uint8_t *)output,
                                     (size_t)length, "response-write") == 0
             ? 0
             : -1;
}

static int open_log(struct admitted_namespace *admitted, int *log_fd,
                    struct stat *log_stat) {
  *log_fd = openat(admitted->directory_fd, "ledger.log",
                   O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_APPEND);
  if (*log_fd < 0 || fstat(*log_fd, log_stat) != 0 ||
      !valid_owned_log(log_stat)) {
    if (*log_fd >= 0)
      (void)close(*log_fd);
    return -1;
  }
  struct stat path_stat;
  if (fstatat(admitted->directory_fd, "ledger.log", &path_stat,
              AT_SYMLINK_NOFOLLOW) != 0 ||
      path_stat.st_dev != log_stat->st_dev ||
      path_stat.st_ino != log_stat->st_ino) {
    (void)close(*log_fd);
    return -1;
  }
  return 0;
}

static int log_still_pinned(const struct admitted_namespace *admitted,
                            int log_fd, const struct stat *admitted_log_stat) {
  struct stat descriptor_stat;
  struct stat path_stat;
  return fstat(log_fd, &descriptor_stat) == 0 &&
         fstatat(admitted->directory_fd, "ledger.log", &path_stat,
                 AT_SYMLINK_NOFOLLOW) == 0 &&
         valid_owned_log(&descriptor_stat) && valid_owned_log(&path_stat) &&
         descriptor_stat.st_dev == admitted_log_stat->st_dev &&
         descriptor_stat.st_ino == admitted_log_stat->st_ino &&
         path_stat.st_dev == descriptor_stat.st_dev &&
         path_stat.st_ino == descriptor_stat.st_ino;
}

static int create_ledger(const char *path) {
  struct admitted_namespace admitted;
  if (admit_namespace(path, 1, &admitted) != 0) {
    fail("namespace-admission-rejected", 0);
    return 2;
  }
  int log_fd = openat(admitted.directory_fd, "ledger.log",
                      O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_CREAT | O_EXCL, 0600);
  struct stat log_stat;
  if (log_fd < 0 || fstat(log_fd, &log_stat) != 0 ||
      !valid_owned_log(&log_stat)) {
    fail("log-create-rejected", 0);
    close_admitted(&admitted);
    return 2;
  }
  uint8_t header[LOG_HEADER_SIZE] = {0};
  (void)memcpy(header, LOG_MAGIC, sizeof(LOG_MAGIC));
  put_u32(header + 8U, 1U);
  put_u32(header + 12U, LOG_HEADER_SIZE);
  arc4random_buf(header + 16U, 32U);
  put_u32(header + 60U, crc32_bytes(header, 60U));
  if (full_write_at_point(log_fd, header, sizeof(header),
                          "create-header-write") != 0 ||
      retry_fsync(log_fd) != 0 || retry_fsync(admitted.directory_fd) != 0 ||
      retry_fsync(admitted.parent_fd) != 0 ||
      !namespace_still_pinned(&admitted) ||
      !log_still_pinned(&admitted, log_fd, &log_stat)) {
    fail("create-durability-rejected", 1);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  struct ledger_state state;
  int ambiguous = 0;
  if (validate_log(log_fd, &state, &ambiguous) != 0) {
    fail("created-log-invalid", ambiguous);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  if (print_state("create", &admitted, &log_stat, &state) != 0) {
    fail("create-response-ambiguous", 1);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  (void)close(log_fd);
  close_admitted(&admitted);
  return 0;
}

static int inspect_ledger(const char *path, const char *operation) {
  struct admitted_namespace admitted;
  if (admit_namespace(path, 0, &admitted) != 0) {
    fail("namespace-admission-rejected", 0);
    return 2;
  }
  int log_fd;
  struct stat log_stat;
  if (open_log(&admitted, &log_fd, &log_stat) != 0 || barrier() != 0 ||
      retry_flock(log_fd, LOCK_EX) != 0) {
    fail("log-admission-rejected", 0);
    close_admitted(&admitted);
    return 2;
  }
  struct ledger_state state;
  int ambiguous = 0;
  const int chain_valid = validate_log(log_fd, &state, &ambiguous) == 0;
  const int identity_valid = chain_valid && namespace_still_pinned(&admitted) &&
                             log_still_pinned(&admitted, log_fd, &log_stat);
  const int valid = chain_valid && identity_valid;
  if (!valid) {
    if (chain_valid && !identity_valid)
      fail("post-inspect-identity-ambiguous", 1);
    else
      fail(ambiguous ? "torn-log-ambiguous" : "log-validation-rejected",
           ambiguous);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  if (print_state(operation, &admitted, &log_stat, &state) != 0) {
    fail("inspect-response-rejected", 0);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  (void)close(log_fd);
  close_admitted(&admitted);
  return 0;
}

static int read_payload(uint8_t **payload, uint32_t *length) {
  size_t capacity = 4096U;
  size_t used = 0U;
  uint8_t *bytes = malloc(capacity);
  if (bytes == NULL)
    return -1;
  for (;;) {
    if (used == capacity) {
      if (capacity >= MAX_PAYLOAD_SIZE + 1U) {
        free(bytes);
        return -1;
      }
      capacity *= 2U;
      if (capacity > MAX_PAYLOAD_SIZE + 1U)
        capacity = MAX_PAYLOAD_SIZE + 1U;
      uint8_t *expanded = realloc(bytes, capacity);
      if (expanded == NULL) {
        free(bytes);
        return -1;
      }
      bytes = expanded;
    }
    ssize_t amount;
    if (inject_eintr("read"))
      amount = -1;
    else
      amount = read(STDIN_FILENO, bytes + used, capacity - used);
    if (amount < 0 && errno == EINTR)
      continue;
    if (amount < 0) {
      free(bytes);
      return -1;
    }
    if (amount == 0)
      break;
    used += (size_t)amount;
    if (used > MAX_PAYLOAD_SIZE) {
      free(bytes);
      return -1;
    }
  }
  if (used == 0U) {
    free(bytes);
    return -1;
  }
  *payload = bytes;
  *length = (uint32_t)used;
  return 0;
}

static int append_ledger(int argc, char **argv) {
  if (argc != 10) {
    fail("argument-count-invalid", 0);
    return 2;
  }
  char *sequence_end = NULL;
  char *ns_device_end = NULL;
  char *ns_inode_end = NULL;
  char *log_device_end = NULL;
  char *log_inode_end = NULL;
  const uint64_t expected_sequence = strtoull(argv[4], &sequence_end, 10);
  const uint64_t expected_ns_device = strtoull(argv[6], &ns_device_end, 10);
  const uint64_t expected_ns_inode = strtoull(argv[7], &ns_inode_end, 10);
  const uint64_t expected_log_device = strtoull(argv[8], &log_device_end, 10);
  const uint64_t expected_log_inode = strtoull(argv[9], &log_inode_end, 10);
  uint8_t expected_session[32];
  uint8_t expected_root[32];
  if (*sequence_end != '\0' || *ns_device_end != '\0' ||
      *ns_inode_end != '\0' || *log_device_end != '\0' ||
      *log_inode_end != '\0' || hex_decode_32(argv[3], expected_session) != 0 ||
      hex_decode_32(argv[5], expected_root) != 0) {
    fail("argument-shape-invalid", 0);
    return 2;
  }
  uint8_t *payload = NULL;
  uint32_t payload_length = 0U;
  if (read_payload(&payload, &payload_length) != 0) {
    fail("payload-invalid", 0);
    return 2;
  }
  maybe_crash("before-lock");
  struct admitted_namespace admitted;
  if (admit_namespace(argv[2], 0, &admitted) != 0) {
    free(payload);
    fail("namespace-admission-rejected", 0);
    return 2;
  }
  int log_fd;
  struct stat log_stat;
  if (open_log(&admitted, &log_fd, &log_stat) != 0 || barrier() != 0 ||
      retry_flock(log_fd, LOCK_EX) != 0) {
    free(payload);
    fail("log-lock-rejected", 0);
    close_admitted(&admitted);
    return 2;
  }
  maybe_crash("after-lock");
  struct ledger_state state;
  int ambiguous = 0;
  if (validate_log(log_fd, &state, &ambiguous) != 0) {
    free(payload);
    fail(ambiguous ? "torn-log-ambiguous" : "log-validation-rejected",
         ambiguous);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  maybe_crash("after-validation");
  if (!namespace_still_pinned(&admitted) ||
      !log_still_pinned(&admitted, log_fd, &log_stat) ||
      (uint64_t)admitted.directory_stat.st_dev != expected_ns_device ||
      (uint64_t)admitted.directory_stat.st_ino != expected_ns_inode ||
      (uint64_t)log_stat.st_dev != expected_log_device ||
      (uint64_t)log_stat.st_ino != expected_log_inode ||
      memcmp(state.session, expected_session, 32U) != 0) {
    free(payload);
    fail("identity-mismatch", 0);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  if (state.sequence != expected_sequence ||
      memcmp(state.root, expected_root, 32U) != 0) {
    free(payload);
    fail("stale-cas", 0);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  const uint32_t total =
      RECORD_HEADER_SIZE + payload_length + RECORD_TRAILER_SIZE;
  if ((uint64_t)state.valid_size + total > MAX_LOG_SIZE) {
    free(payload);
    fail("log-size-limit", 0);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  uint8_t *record = calloc(1U, total);
  if (record == NULL) {
    free(payload);
    fail("allocation-failed", 0);
    (void)close(log_fd);
    close_admitted(&admitted);
    return 2;
  }
  (void)memcpy(record, RECORD_MAGIC, 4U);
  put_u32(record + 4U, 1U);
  put_u32(record + 8U, total);
  put_u32(record + 12U, payload_length);
  put_u64(record + 16U, state.sequence + 1U);
  (void)memcpy(record + 24U, state.root, 32U);
  (void)memcpy(record + RECORD_HEADER_SIZE, payload, payload_length);
  const size_t digest_offset = RECORD_HEADER_SIZE + payload_length;
  sha256_bytes(record, digest_offset, record + digest_offset);
  put_u32(record + digest_offset + 32U,
          crc32_bytes(record, digest_offset + 32U));
  (void)memcpy(record + digest_offset + 36U, FOOTER_MAGIC, 4U);
  free(payload);
  maybe_crash("before-header");
  if (full_write_at_point(log_fd, record, RECORD_HEADER_SIZE / 2U,
                          "record-header-write") != 0)
    goto write_failure;
  maybe_crash("during-header");
  if (full_write_at_point(log_fd, record + (RECORD_HEADER_SIZE / 2U),
                          (RECORD_HEADER_SIZE / 2U),
                          "record-header-write") != 0)
    goto write_failure;
  const uint32_t first_payload = payload_length / 2U;
  if (full_write_at_point(log_fd, record + RECORD_HEADER_SIZE, first_payload,
                          "record-payload-write") != 0)
    goto write_failure;
  maybe_crash("during-payload");
  if (full_write_at_point(log_fd, record + RECORD_HEADER_SIZE + first_payload,
                          payload_length - first_payload,
                          "record-payload-write") != 0)
    goto write_failure;
  maybe_crash("before-footer");
  if (full_write_at_point(log_fd, record + digest_offset, RECORD_TRAILER_SIZE,
                          "record-footer-write") != 0)
    goto write_failure;
  maybe_crash("after-record-before-sync");
  if (retry_fsync(log_fd) != 0)
    goto write_failure;
  maybe_crash("after-file-sync");
  if (!namespace_still_pinned(&admitted) ||
      !log_still_pinned(&admitted, log_fd, &log_stat))
    goto identity_failure;
  maybe_crash("before-directory-sync");
  if (retry_fsync(admitted.directory_fd) != 0)
    goto write_failure;
  maybe_crash("after-directory-sync");
  if (fstat(log_fd, &log_stat) != 0 || !valid_owned_log(&log_stat) ||
      !namespace_still_pinned(&admitted) ||
      !log_still_pinned(&admitted, log_fd, &log_stat))
    goto identity_failure;
  state.sequence++;
  (void)memcpy(state.root, record + digest_offset, 32U);
  state.valid_size += total;
  if (print_state("append", &admitted, &log_stat, &state) != 0)
    goto response_failure;
  maybe_crash("after-return");
  free(record);
  (void)close(log_fd);
  close_admitted(&admitted);
  return 0;

write_failure:
  free(record);
  fail("append-io-ambiguous", 1);
  (void)close(log_fd);
  close_admitted(&admitted);
  return 2;

identity_failure:
  free(record);
  fail("post-append-identity-ambiguous", 1);
  (void)close(log_fd);
  close_admitted(&admitted);
  return 2;

response_failure:
  free(record);
  fail("append-response-ambiguous", 1);
  (void)close(log_fd);
  close_admitted(&admitted);
  return 2;
}

int main(int argc, char **argv) {
  if (getenv("M9B13K4A_EINTR_POINT") != NULL) {
    struct sigaction action;
    (void)memset(&action, 0, sizeof(action));
    action.sa_handler = ignore_signal;
    (void)sigemptyset(&action.sa_mask);
    if (sigaction(SIGUSR1, &action, NULL) != 0) {
      fail("signal-handler-rejected", 0);
      return 2;
    }
  }
  const char *output_fault = getenv("M9B13K4A_OUTPUT_FAULT");
  if (output_fault != NULL && strcmp(output_fault, "malformed") == 0) {
    (void)full_write_at_point(STDOUT_FILENO,
                              (const uint8_t *)"MALFORMED EXTRA OUTPUT\n", 23U,
                              "response-write");
    return 0;
  }
  if (argc == 3 && strcmp(argv[1], "create") == 0)
    return create_ledger(argv[2]);
  if (argc == 3 && strcmp(argv[1], "snapshot") == 0)
    return inspect_ledger(argv[2], "snapshot");
  if (argc == 3 && strcmp(argv[1], "audit") == 0)
    return inspect_ledger(argv[2], "audit");
  if (argc >= 2 && strcmp(argv[1], "append") == 0)
    return append_ledger(argc, argv);
  fail("operation-invalid", 0);
  return 2;
}
