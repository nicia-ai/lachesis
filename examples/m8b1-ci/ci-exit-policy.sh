#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: ci-exit-policy.sh <catalog-compare-exit>" >&2
  exit 64
fi

case "$1" in
  0)
    exit 0
    ;;
  10)
    if [ "${LACHESIS_ALLOW_REVIEW_REQUIRED:-}" = "1" ]; then
      echo "catalog comparison requires repository-authorized review" >&2
      exit 0
    fi
    echo "catalog comparison requires review; policy did not authorize it" >&2
    exit 10
    ;;
  11 | 12 | 13)
    echo "unsafe or insufficient semantic outcome; CI rejects" >&2
    exit "$1"
    ;;
  20 | 21 | 22 | 23 | 70)
    echo "catalog workflow failed closed" >&2
    exit "$1"
    ;;
  *)
    echo "unsupported catalog command exit" >&2
    exit 64
    ;;
esac
