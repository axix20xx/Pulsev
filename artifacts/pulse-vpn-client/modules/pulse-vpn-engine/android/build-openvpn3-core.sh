#!/usr/bin/env bash
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OPENVPN3_OUTPUT_DIR:?OPENVPN3_OUTPUT_DIR must be set by Gradle}"
NDK_DIR="${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must be set by Gradle}"
BUILD_DIR="${OPENVPN3_BUILD_DIR:-$MODULE_DIR/build/openvpn3}"
DOWNLOAD_DIR="$BUILD_DIR/downloads"
SOURCE_DIR="$BUILD_DIR/source"
JAVA_OUT="$OUTPUT_DIR/java"
JNI_OUT="$OUTPUT_DIR/jniLibs"
API_LEVEL=24

mkdir -p "$DOWNLOAD_DIR" "$SOURCE_DIR"
rm -rf "$JAVA_OUT" "$JNI_OUT"
mkdir -p "$JAVA_OUT" "$JNI_OUT"

fetch_archive() {
  local name="$1"
  local url="$2"
  local archive="$DOWNLOAD_DIR/$name"

  if [[ ! -f "$archive" ]]; then
    curl --fail --location --silent --show-error "$url" --output "$archive.tmp"
    mv "$archive.tmp" "$archive"
  fi
  printf '%s\n' "$archive"
}

source_tree_hash() {
  local source_dir="$1"
  (
    cd "$source_dir"
    find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
  )
}

extract_verified_source() {
  local archive="$1"
  local destination="$2"
  local expected_tree_hash="$3"
  local source_name="$4"
  rm -rf "$destination"
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
  local actual_tree_hash
  actual_tree_hash="$(source_tree_hash "$destination")"
  if [[ "$actual_tree_hash" != "$expected_tree_hash" ]]; then
    echo "Source tree verification failed for $source_name ($actual_tree_hash)" >&2
    exit 1
  fi
}

OPENVPN_ARCHIVE="$(fetch_archive \
  openvpn3-3.11.7.tar.gz \
  https://codeload.github.com/OpenVPN/openvpn3/tar.gz/refs/tags/release/3.11.7)"
ASIO_ARCHIVE="$(fetch_archive \
  asio-1.24.0.tar.gz \
  https://codeload.github.com/chriskohlhoff/asio/tar.gz/refs/tags/asio-1-24-0)"
LZ4_ARCHIVE="$(fetch_archive \
  lz4-1.8.3.tar.gz \
  https://codeload.github.com/lz4/lz4/tar.gz/refs/tags/v1.8.3)"
MBEDTLS_ARCHIVE="$(fetch_archive \
  mbedtls-2.28.4.tar.gz \
  https://codeload.github.com/Mbed-TLS/mbedtls/tar.gz/refs/tags/mbedtls-2.28.4)"

OPENVPN_SRC="$SOURCE_DIR/openvpn3"
ASIO_SRC="$SOURCE_DIR/asio"
LZ4_SRC="$SOURCE_DIR/lz4"
MBEDTLS_SRC="$SOURCE_DIR/mbedtls"
# Pin extracted source contents rather than gzip bytes: GitHub can regenerate
# the same tagged archive with a different gzip timestamp or root directory.
extract_verified_source "$OPENVPN_ARCHIVE" "$OPENVPN_SRC" \
  bd47152baee2c89ee6f0b8e981cae415ba0221cae6bc468bbcff771d227749d9 \
  "OpenVPN 3.11.7"
extract_verified_source "$ASIO_ARCHIVE" "$ASIO_SRC" \
  910d82bbd575aea8148fed2aa943287f7b6379dbb6e0ad525d7438d8975f5673 \
  "Asio 1.24.0"
extract_verified_source "$LZ4_ARCHIVE" "$LZ4_SRC" \
  c29206c9dff9c6bf549a4080057e2297b782314e1ede5df3b2e48234a84cd1e5 \
  "LZ4 1.8.3"
extract_verified_source "$MBEDTLS_ARCHIVE" "$MBEDTLS_SRC" \
  5d8fd16403b22ce9479bf7ef079c439e414882b2c266dd1bd07b8f55a459980a \
  "Mbed TLS 2.28.4"

for patch_file in "$OPENVPN_SRC"/deps/asio/patches/*.patch; do
  (cd "$ASIO_SRC" && patch --batch --forward -p1 < "$patch_file")
done

# OpenVPN's NTLM support depends on the optional MbedTLS MD4 implementation.
sed -i 's|^//#define MBEDTLS_MD4_C$|#define MBEDTLS_MD4_C|' "$MBEDTLS_SRC/include/mbedtls/config.h"

TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin"

build_abi() {
  local abi="$1"
  local triple="$2"
  local abi_build="$BUILD_DIR/abi-$abi"
  local obj_mbed="$abi_build/mbedtls-objects"
  local obj_core="$abi_build/core-objects"
  local cc="$TOOLCHAIN/${triple}${API_LEVEL}-clang"
  local cxx="$TOOLCHAIN/${triple}${API_LEVEL}-clang++"
  local ar="$TOOLCHAIN/llvm-ar"
  local ranlib="$TOOLCHAIN/llvm-ranlib"
  local mbed_archive="$abi_build/libmbedtls.a"
  local lz4_archive="$abi_build/liblz4.a"
  local library_dir="$JNI_OUT/$abi"

  if [[ ! -x "$cc" || ! -x "$cxx" ]]; then
    echo "NDK compiler missing for ABI $abi: $cxx" >&2
    exit 1
  fi

  mkdir -p "$obj_mbed" "$obj_core" "$library_dir"
  rm -f "$obj_mbed"/*.o "$obj_core"/*.o "$mbed_archive" "$lz4_archive"

  for source in "$MBEDTLS_SRC"/library/*.c; do
    local object="$obj_mbed/$(basename "${source%.c}").o"
    "$cc" \
      -I"$MBEDTLS_SRC/include" \
      -DMBEDTLS_RELAXED_X509_DATE \
      -O2 -fPIC -c "$source" -o "$object"
  done
  "$ar" rcs "$mbed_archive" "$obj_mbed"/*.o
  "$ranlib" "$mbed_archive"

  "$cc" -I"$LZ4_SRC/lib" -O2 -fPIC -c "$LZ4_SRC/lib/lz4.c" -o "$obj_core/lz4.o"
  "$ar" rcs "$lz4_archive" "$obj_core/lz4.o"
  "$ranlib" "$lz4_archive"

  local -a common_flags=(
    -std=c++17
    -fPIC
    -O2
    -fvisibility=hidden
    -Wno-sign-compare
    -Wno-unused-parameter
    -Wno-unused-local-typedefs
    -DOPENVPN_PACKAGE_ID=net_openvpn_ovpn3
    -DUSE_MBEDTLS
    -DUSE_ASIO
    -DASIO_STANDALONE
    -DASIO_NO_DEPRECATED
    -DHAVE_LZ4
    -DOPENVPN_ALLOW_INSECURE_CERTPROFILE
    -DASIO_HAS_STD_STRING_VIEW
    -I"$OPENVPN_SRC/client"
    -I"$OPENVPN_SRC"
    -I"$ASIO_SRC/asio/include"
    -I"$MBEDTLS_SRC/include"
    -I"$LZ4_SRC/lib"
  )

  "$cxx" "${common_flags[@]}" \
    -c "$OPENVPN_SRC/client/ovpncli.cpp" \
    -o "$obj_core/ovpncli.o"
  "$cxx" "${common_flags[@]}" \
    '-DSWIGEXPORT=__attribute__((visibility("default")))' \
    -c "$OUTPUT_DIR/ovpncli_wrap.cxx" \
    -o "$obj_core/ovpncli_wrap.o"
  "$cxx" "${common_flags[@]}" \
    -c "$OPENVPN_SRC/javacli/android/cpu.cpp" \
    -o "$obj_core/cpu.o"

  "$cxx" -shared -Wl,-soname,libovpn3.so \
    -Wl,-z,max-page-size=16384 \
    -o "$library_dir/libovpn3.so" \
    "$obj_core/ovpncli.o" \
    "$obj_core/ovpncli_wrap.o" \
    "$obj_core/cpu.o" \
    "$mbed_archive" \
    "$lz4_archive" \
    -llog
}

swig \
  -c++ \
  -java \
  -package net.openvpn.ovpn3 \
  -I"$OPENVPN_SRC/client" \
  -I"$OPENVPN_SRC" \
  -outdir "$JAVA_OUT" \
  -o "$OUTPUT_DIR/ovpncli_wrap.cxx" \
  "$OPENVPN_SRC/client/ovpncli.i"

build_abi armeabi-v7a armv7a-linux-androideabi
build_abi arm64-v8a aarch64-linux-android
build_abi x86 i686-linux-android
build_abi x86_64 x86_64-linux-android

touch "$OUTPUT_DIR/.complete"
echo "Built OpenVPN 3.11.7 native core for armeabi-v7a, arm64-v8a, x86, and x86_64."
