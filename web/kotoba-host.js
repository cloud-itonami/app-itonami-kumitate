// wasm32-browser-static/v1 Worker host (JUN-353). Static and dependency-free:
// no fetch, no network, no imports. It instantiates one module produced by
// `amu compile SRC --target wasm32-browser` (seed/81 + seed/82: the guest and
// the Kotoba runtime in one module), calls its export start(fuel) and returns
// what the run wrote:
//   {exit, stdout, stderr, wasmTrap, output, report}
// stdout carries the native KEXE_STRUCTURED_REPORT line last
// ({:status :ok :result R :fuel {...}} or {:status :trap :exit 120 :fuel {...}});
// report is that line and output is stdout before it.
//
// Message in: {bytes | module, fuel, allow?, args?, files?}. bytes is the
// module's bytes (or module an already compiled WebAssembly.Module); allow
// lists the wires the page grants, as KEXE_ALLOW does natively, and only
// 35 (:fs/app-data, read-only), 37 (:io/write), 38 (:cli/args) and
// 39 (:io/write-error) can be granted; args is the command line as strings
// (without a program name); files maps absolute paths to strings or
// Uint8Arrays. They are the run's own data, held by the page in this browser:
// the entry ABI (seed/82) reads them, and nothing else. Without allow every
// wire is refused, as in Phase 1.
//
// Imports (module "kotoba:host"), all i64:
//   write(fd, ptr, len) -> len   fd 1 = stdout, 2 = stderr; other fds -> -9 (EBADF)
//   cap(wire, ptr, len) -> -1    every capability is refused until Phase 2; this is
//                                where the shared consent broker
//                                (kotoba-client-runtime.js) plugs in (Phase 2)
//   now() -> nanoseconds since the epoch
//   exit(code)                   ends the run (throws out of the module)
//   input(kind, i, ptr, len, dst, cap) -> length or -1
//                                the entry ABI: kind 0 is argument i (i = -1:
//                                the count), kind 1 the file whose absolute
//                                path is the UTF-8 bytes [ptr, ptr+len); the
//                                bytes are copied to dst only when cap >= the
//                                length. Serves :cli/args and read-only
//                                :fs/app-data (wires 38, 35). kind 2 asks
//                                whether the page grants wire i (1 or 0).
//                                Not a capability: no service is reached.
//
// The function is written so that a page can start it as a Worker from a Blob
// (`(${kotobaWasm32BrowserStaticHost})()`), which works from file:// pages, and
// it installs itself when this file is loaded as a Worker script.
"use strict";
function kotobaWasm32BrowserStaticHost() {
  class HostExit {
    constructor(code) { this.code = code; }
  }
  function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const all = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return new TextDecoder("utf-8").decode(all);
  }
  // "/a/./b/../c" -> "/a/c"; null when not absolute
  function normal(path) {
    if (!path.startsWith("/")) return null;
    const out = [];
    for (const part of path.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") out.pop(); else out.push(part);
    }
    return "/" + out.join("/");
  }
  function inputs(args, files) {
    const enc = new TextEncoder();
    const argv = (args || []).map((a) => enc.encode(String(a)));
    const fs = new Map();
    for (const [k, v] of Object.entries(files || {})) {
      const p = normal(k);
      if (p !== null) fs.set(p, typeof v === "string" ? enc.encode(v) : new Uint8Array(v));
    }
    return { argv, fs };
  }
  async function run(msg) {
    const fuel = msg.fuel || 0;
    const { argv, fs } = inputs(msg.args, msg.files);
    const allow = new Set((msg.allow || []).map(Number).filter((w) => [35, 37, 38, 39].includes(w)));
    const stdout = [], stderr = [];
    let memory = null;
    const answer = (bytes, dst, cap) => {
      if (bytes === undefined) return -1n;
      if (cap >= BigInt(bytes.length) && bytes.length > 0) {
        new Uint8Array(memory.buffer, Number(dst), bytes.length).set(bytes);
      }
      return BigInt(bytes.length);
    };
    const imports = {
      "kotoba:host": {
        write(fd, ptr, len) {
          if (fd !== 1n && fd !== 2n) return -9n;
          const chunk = new Uint8Array(memory.buffer, Number(ptr), Number(len)).slice();
          (fd === 1n ? stdout : stderr).push(chunk);
          return len;
        },
        cap(wire, ptr, len) { return -1n; },
        now() { return BigInt(Date.now()) * 1000000n; },
        exit(code) { throw new HostExit(Number(code)); },
        input(kind, i, ptr, len, dst, cap) {
          if (kind === 0n) return i === -1n ? BigInt(argv.length) : answer(argv[Number(i)], dst, cap);
          if (kind === 2n) return allow.has(Number(i)) ? 1n : 0n;
          if (kind !== 1n) return -1n;
          let path;
          try {
            path = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(memory.buffer, Number(ptr), Number(len)));
          } catch (e) { return -1n; }
          const p = normal(path);
          return p === null ? -1n : answer(fs.get(p), dst, cap);
        },
      },
    };
    let exit = null, wasmTrap = null;
    try {
      const instance = msg.module
        ? await WebAssembly.instantiate(msg.module, imports)
        : (await WebAssembly.instantiate(msg.bytes, imports)).instance;
      memory = instance.exports.memory;
      instance.exports.start(BigInt(fuel));
      wasmTrap = "start returned without exit";
    } catch (e) {
      if (e instanceof HostExit) exit = e.code;
      else wasmTrap = String((e && e.message) || e);
    }
    // A wasm trap outside the runtime's handler (for example stack exhaustion)
    // ends the run as a native signal would: exit 120.
    if (exit === null) exit = 120;
    const out = concat(stdout);
    const cut = out.lastIndexOf("{:status ", out.length - 2);
    const last = cut >= 0 && (cut === 0 || out[cut - 1] === "\n") && out.endsWith("}\n");
    return { exit, stdout: out, stderr: concat(stderr), wasmTrap,
             output: last ? out.slice(0, cut) : out, report: last ? out.slice(cut, -1) : null };
  }
  self.onmessage = async (e) => {
    self.postMessage(await run(e.data));
  };
}
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  kotobaWasm32BrowserStaticHost();
}
