#!/usr/bin/env bash
set -euo pipefail

version="v22.23.2"
archive="node-${version}-linux-x64.tar.xz"
checksum="d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307"
install_root="/opt/node-${version}"
download_root="$(mktemp -d)"

cleanup() {
  rm -rf "${download_root}"
}
trap cleanup EXIT

curl -fsSLo "${download_root}/${archive}" "https://nodejs.org/dist/${version}/${archive}"
(
  cd "${download_root}"
  printf '%s  %s\n' "${checksum}" "${archive}" | sha256sum -c -
)

install -d -m 0755 "${install_root}"
tar -xJf "${download_root}/${archive}" --strip-components=1 -C "${install_root}"

for executable in node npm npx corepack; do
  ln -sfn "${install_root}/bin/${executable}" "/usr/local/bin/${executable}"
done

node --version
npm --version
