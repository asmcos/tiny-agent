# Car Control Example

This folder contains a small, hardware-agnostic “car controller” you can run locally.

It supports two transports:
- `mock`: simulates movement and prints the resulting pose
- `http`: sends commands to a local HTTP server that you implement for your specific car/MCU

## Mock mode (no hardware)

```bash
npx tsx examples/car-control/cli.ts --transport mock --script "forward:10cm; turn_left:90deg; forward:20cm; stop"
```

## HTTP mode (you provide the HTTP server)

Expected request:
- `POST {baseUrl}/car/command` (default path)
- Body: JSON matching `{ action, value?, unit? }`

Example:
```bash
npx tsx examples/car-control/cli.ts \
  --transport http \
  --baseUrl http://localhost:8080 \
  --script "forward:10cm; turn_right:90deg; forward:10cm; stop"
```

If you want a different path, use `--commandPath`.

