# Third-Party Licenses

This file lists the direct third-party dependencies declared in `package.json`.
Exact versions, including transitive dependencies, are recorded in
`pnpm-lock.yaml`. License files for transitive dependencies are distributed
with their respective npm packages.

## Distribution Scope

The web application generated in `dist/` does not bundle the npm packages
listed below. `jpeg-js` and `pngjs` are used only by the optional development
CLI. The remaining packages are used for development, testing, or builds.

## CLI Dependencies

### MIT

- pngjs@7.0.0 — Copyright (c) 2015 Luke Page & Original Contributors; derived work Copyright (c) 2012 Kuba Niegowski

### BSD-3-Clause

- jpeg-js@0.4.4 — Copyright (c) 2014, Eugene Ware

## Development Tools

These packages are not included in the web distribution.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| @types/node | 26.4.0 | MIT | Type definitions |
| @types/pngjs | 6.0.5 | MIT | Type definitions |
| tsx | 4.23.13 | MIT | CLI runner |
| TypeScript | 7.0.2 | Apache-2.0 | Compiler |
| Vite | 8.2.2 | MIT | Build tool |
| Vitest | 4.1.11 | MIT | Test tool |

## License Texts for CLI Dependencies

### MIT (pngjs)

```text
pngjs original work Copyright (c) 2015 Luke Page & Original Contributors
pngjs derived work Copyright (c) 2012 Kuba Niegowski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### BSD-3-Clause (jpeg-js)

```text
Copyright (c) 2014, Eugene Ware
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of Eugene Ware nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY EUGENE WARE ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL EUGENE WARE BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
