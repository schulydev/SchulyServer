#!/usr/bin/env bash
# Regenerates the Swiss network list used by SignUp:SwitzerlandOnly from RIPE's public registry data.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/src/Schuly.API/SignUp/swiss-networks.txt"

curl -fsSL https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest | awk -F'|' '
  $2 == "CH" && $3 == "ipv6" { print $4 "/" $5 }
  $2 == "CH" && $3 == "ipv4" {
    split($4, o, ".")
    n = o[1] * 16777216 + o[2] * 65536 + o[3] * 256 + o[4]
    left = $5
    # RIPE gives a start and a count, which need not be one CIDR block.
    while (left > 0) {
      size = 1
      while (n % (size * 2) == 0 && size * 2 <= left) size *= 2
      bits = 32
      for (s = size; s > 1; s /= 2) bits--
      printf "%d.%d.%d.%d/%d\n", int(n / 16777216), int(n / 65536) % 256, int(n / 256) % 256, n % 256, bits
      n += size
      left -= size
    }
  }
' > "$out"

wc -l "$out"
