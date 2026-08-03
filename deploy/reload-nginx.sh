#!/usr/bin/env bash
set -euo pipefail

/usr/sbin/nginx -t
/usr/sbin/nginx -s reload
