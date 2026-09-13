# MCP IoT Device
Copyright 2026 Moddable Tech, Inc.  
Updated September 13, 2026

This example turns an ESP32-S3 (or the desktop simulator) into an IoT node that:

- Samples sensors and drives controllers
- Runs **on-device ML/heuristics** (online stats, z-score anomalies, EWMA, trend slope, policy rules, and a tiny linear classifier)
- Speaks **Model Context Protocol (MCP)** over HTTP so Cursor, Claude, or another AI client can connect and operate the device

TensorFlow Lite is intentionally not used. It is C++, large, and a poor fit for the Moddable SDK. The native path here is a small JavaScript inference and policy engine that stays resident on the MCU and can act without a cloud round-trip.

## Why this shape

| Need | Approach |
| --- | --- |
| Decide device operation from live data | Heuristic engine + policy rules on the device |
| Let an AI inspect and intervene | MCP tools and resources |
| Work on ESP32-S3 RAM/Flash | Fixed-size windows, no C++ runtime |
| Develop without hardware | Host server on Node.js using the same modules |

## Build for ESP32-S3

```
cd $MODDABLE/examples/network/mcp-iot
mcconfig -d -m -p esp32/esp32_s3 ssid="your-wifi" password="secret"
```

Any ESP32-S3 board target works (`esp32/esp32_s3`, `esp32/moddable_six`, `esp32/xiao_esp32s3`, and others). The app uses simulated sensors by default so it runs without extra hardware. Controllers are virtual outputs unless you wire them in `device.js`.

After Wi-Fi is up the device advertises `iot-device.local` and listens on port 8080:

- `http://iot-device.local:8080/` — live status page
- `POST http://iot-device.local:8080/mcp` — MCP JSON-RPC endpoint

## Simulator / host (no MCU)

The same device logic runs under Node.js:

```
cd $MODDABLE/examples/network/mcp-iot
node --import ./node-aliases.mjs host-server.mjs
```

Then open `http://127.0.0.1:8080/`.

## Connect an AI with MCP

### HTTP (clients that support Streamable HTTP)

```json
{
  "mcpServers": {
    "esp32-iot": {
      "url": "http://iot-device.local:8080/mcp"
    }
  }
}
```

### stdio proxy (Cursor, Claude Desktop)

```
node $MODDABLE/examples/network/mcp-iot/mcp-proxy.mjs http://192.168.1.50:8080/mcp
```

```json
{
  "mcpServers": {
    "esp32-iot": {
      "command": "node",
      "args": [
        "/absolute/path/to/moddable/examples/network/mcp-iot/mcp-proxy.mjs",
        "http://iot-device.local:8080/mcp"
      ]
    }
  }
}
```

## Tools the model can call

| Tool | Purpose |
| --- | --- |
| `read_sensors` | Current values, z-scores, anomaly flags |
| `read_sensor_history` | Sliding window for one sensor |
| `get_device_status` | Mode, health, controllers, last actions |
| `set_controller` | Drive fan, heater, grow light, pump, alarm |
| `set_mode` | `auto` (heuristics run the plant) or `manual` |
| `get_heuristics` | Latest evaluation and linear-model prediction |
| `list_policies` / `set_policy` / `remove_policy` | Edit operating rules |
| `train_baseline` | Freeze normal-operation statistics |
| `train_model` / `predict` | Fit and run the on-device classifier |
| `inject_sample` | Override a sensor to test a rule (host / debug) |

In `auto` mode the policy engine maps conditions such as "temperature > 27°C" onto controllers. The simulator closes the loop: the fan cools, the heater warms, the pump raises soil moisture. That is what "heuristics determine device operation" means on-device.

## Modules

- [`modules/data/ml`](../../../modules/data/ml) — stats, EWMA, anomalies, linear model, policies
- [`modules/network/mcp`](../../../modules/network/mcp) — MCP JSON-RPC 2.0 server
