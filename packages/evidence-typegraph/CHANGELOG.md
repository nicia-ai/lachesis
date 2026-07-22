# Changelog

## 0.1.0-alpha.3

- Dependency-only synchronized release with the alpha.3 kernel, evidence, and
  runtime packages; no TypeGraph API or behavior change.

## 0.1.0-alpha.2

- Dependency-only synchronized release with the alpha.2 kernel, evidence, and
  runtime packages; no TypeGraph adapter API or behavior changes.

## 0.1.0-alpha.1

- Publishes the optional TypeGraph 0.38 evidence-store adapter as a stable alpha
  integration package.
- Keeps host-provided `HistoryStore` support in the portable root export.
- Keeps managed `better-sqlite3` behind the Node-only `./sqlite` subpath and
  adds strict private-file preparation and permission audits.
