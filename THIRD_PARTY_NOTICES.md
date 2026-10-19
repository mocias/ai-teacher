# Third-party notices

AI Teacher's Apache-2.0 license applies to its original code. Third-party components retain their own copyright, licenses, and notices. This inventory does not relicense them.

## Desktop runtimes

- Node.js v24.13.0: exact upstream license and bundled-component notices are in [licenses/Node-LICENSE.txt](licenses/Node-LICENSE.txt), retrieved from https://raw.githubusercontent.com/nodejs/node/v24.13.0/LICENSE. The desktop build copies this alongside the bundled Node executable.
- Electron 44.4.1: [licenses/Electron-LICENSE.txt](licenses/Electron-LICENSE.txt). The distributed Electron runtime also carries its own LICENSE and LICENSES.chromium.html; retain both when redistributing the application folder.

## Production npm dependencies

Generated from package-lock.json and installed package license/notice files. Full texts, including copyright notices, are preserved in [licenses/npm-LICENSES.txt](licenses/npm-LICENSES.txt). Build-only dependencies are not shipped with the application and are not listed below.

| Package | Version | License declaration |
| --- | --- | --- |
| @hono/node-server | 2.1.1 | MIT |
| @modelcontextprotocol/sdk | 1.32.1 | MIT |
| ajv-formats | 3.0.1 | MIT |
| @napi-rs/canvas | 1.0.9 | MIT |
| @napi-rs/canvas-win32-x64-msvc | 1.0.9 | MIT |
| @types/trusted-types | 2.0.7 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 8.20.0 | MIT |
| body-parser | 2.3.0 | MIT |
| content-type | 2.1.0 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| content-disposition | 1.1.0 | MIT |
| content-type | 1.0.5 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| depd | 2.0.0 | MIT |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| encodeurl | 2.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.1 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.1 | MIT |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.7.0 | MIT |
| cookie | 0.7.2 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.8 | BSD-3-Clause |
| finalhandler | 2.1.1 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.3 | MIT |
| hono | 4.13.7 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| inherits | 2.0.4 | ISC |
| ip-address | 10.7.4 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jose | 6.2.12 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| marked | 18.0.14 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.1 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| ms | 2.1.3 | MIT |
| negotiator | 1.1.0 | MIT |
| content-type | 2.1.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| on-finished | 2.4.1 | MIT |
| once | 1.4.0 | ISC |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| pdfjs-dist | 6.3.289 | Apache-2.0 |
| pkce-challenge | 5.0.1 | MIT |
| proxy-addr | 2.0.8 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| qs | 6.16.0 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| require-from-string | 2.0.2 | MIT |
| router | 2.2.0 | MIT |
| path-to-regexp | 8.4.2 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| statuses | 2.0.2 | MIT |
| toidentifier | 1.0.1 | MIT |
| type-is | 2.1.0 | MIT |
| content-type | 2.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| vary | 1.1.2 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| zod | 3.25.76 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |

Regenerate with `npm run licenses:generate` after dependency or runtime changes. Review any new license terms before distribution.
