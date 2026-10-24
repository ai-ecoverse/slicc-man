# slicc-man

`man`, `apropos` and `whatis` for SLICC, and `scman` for SLICC, macOS, Linux and Windows. They show the pages www.sliccy.com already serves: a page is the Markdown at `https://www.sliccy.com/man/<topic>.md`, the topics are the `/man/*` entries of [`sitemap.xml`](https://www.sliccy.com/sitemap.xml), and a page's one-line description is its first paragraph. The package renders the Markdown itself, so it needs no `man`, groff or mandoc on the host, and keeps what it fetched in an [offline cache](#offline-cache).

In SLICC, the commands are `man`, `apropos`, `whatis` and `scman`, which is `man` under another name. On a host only `scman` is installed, so the host's own `man` is never shadowed.

## Install

In SLICC, the package declares its commands in `slicc.commands`, so installing it puts them in `/usr/bin`:

```sh
pnpm add -g @ai-ecoverse/slicc-man
```

They are one self-contained ES module run by the kernel's JS ABI (`"abi": "js"`), so they need no Node in SLICC, and `engines.slicc-kernel` asks for slicc-kernel 1.91.0 or later, the oldest release the integration tests pass on (an older kernel's `fetch` can't reach `host.slicc.internal`, which they use).

On macOS and Linux:

```sh
curl -fsSL https://get.sliccy.ai/man | sh
```

On Windows, in PowerShell:

```powershell
irm https://get.sliccy.ai/man.ps1 | iex
```

The same installers are attached to every GitHub release, as `install.sh` and `install.ps1`:

```sh
curl -fsSL https://github.com/ai-ecoverse/slicc-man/releases/latest/download/install.sh | sh
```

They install the release's `scman` with a launcher in `~/.local/bin` (on Windows `%LOCALAPPDATA%\slicc-man\bin`, added to the user's `PATH`), with Node 24 or later, which they download when none is on `PATH`. Options reach `install.sh` after `sh -s --` (`curl -fsSL https://get.sliccy.ai/man | sh -s -- --version 1.2.0 --dir ~/bin`), and `install.ps1` through a script block (`& ([scriptblock]::Create((irm https://get.sliccy.ai/man.ps1))) -Version 1.2.0`). [The installer](#the-installer) has the details.

On a machine with Node 24 or later, npm works too:

```sh
npm install -g @ai-ecoverse/slicc-man
scman tree
```

or without installing, `npx -p @ai-ecoverse/slicc-man scman tree`. The package's `bin` has only `scman`.

### The installer

slicc-man's `install.sh`, `install.ps1`, `scripts/assets.mjs` and `host/upgrade.mjs` are slicc-open's ([the installer contract](https://github.com/ai-ecoverse/slicc-open#the-installer) that slicc-open, slicc-capture, slicc-audio and slicc-man share), with the names `slicc-man`, `scman` and `SCMAN`.

**Release assets.** semantic-release's `@semantic-release/npm` packs the package into `release/`. `@semantic-release/exec` then runs `node scripts/assets.mjs release <version>`, which refuses (exit 1, leaving `release/` as it was, npm's tarball name included) when the tarball's `package.json` has no `bin` or lacks a file a `bin` entry names, and otherwise renames the tarball to `slicc-man-<version>.tgz`, copies `install.sh` and `install.ps1` next to it, and writes `SHA256SUMS`: one `<sha256>  <name>` line each for the tarball, `install.sh` and `install.ps1`, in that order. `@semantic-release/github` attaches the four files to the release.

**Options and exit codes.** `--version VERSION` (or `--version=VERSION`; a leading `v` is dropped) installs that release instead of the latest, `--dir DIR` (or `--dir=DIR`) puts the launcher in `DIR`, and `--help` (or `-h`) prints the usage to stdout and exits 0; `install.ps1` spells them `-Version`, `-Dir` and `-Help`. No environment variable stands in for them. `install.sh` handles its options, `--help` and the usage errors included, before it works out any directory, so they work without `HOME`; `HOME` is needed only for the defaults, and without it, and without both `--dir` and `XDG_DATA_HOME`, it exits 1 with `install.sh: HOME is not set; give --dir and set XDG_DATA_HOME`. `install.sh` exits 0 when it installed, 1 when something failed (a download, a checksum, an archive that doesn't unpack, no Node and no way to get one), with `install.sh: <what>` on stderr, and 2 for an unknown option or a missing value, with the usage on stderr. `install.ps1` exits 0 or 1 the same way when it is run as a file; run through `irm … | iex` or a script block, it prints the error and returns instead of calling `exit`, so it never closes the user's PowerShell. It sets `$PSNativeCommandUseErrorActionPreference = $false` in its own scope, so a caller's `$true` (pwsh 7.4 and later) can't turn the exit code of `node`, `tar` or `npm` into an error that stops the install. It runs `node --version`, `tar` and `npm` with `$ErrorActionPreference = 'Continue'` in a child scope, because Windows PowerShell 5.1 turns each line a native command writes to a redirected stderr into an error, and under `'Stop'` the first one would end the install before its `install.ps1:` message.

**Node.** The installer uses the first `node` on `PATH` when it is 24 or later, otherwise one it downloaded before, into `<data>/node`. Failing both, it downloads the newest LTS release of 24 or later (or the newest release, when no LTS qualifies) from nodejs.org's `index.json`: `node-<version>-<os>-<arch>.tar.gz`, or `node-<version>-win-<arch>.zip` on Windows, checked against that release's `SHASUMS256.txt`. An archive that doesn't unpack exits 1 with `install.sh: could not unpack node-<version>-<os>-<arch>.tar.gz` (or `install.ps1: could not unpack node-<version>-win-<arch>.zip`), and leaves neither its temporary directory nor a partial `<data>/node` behind. On musl Linux, where nodejs.org has no build, it says to install Node with the package manager and exits 1.

**Downloads.** `SLICC_INSTALL_BASE_URL` replaces the directory the assets are downloaded from (by default `https://github.com/ai-ecoverse/slicc-man/releases/latest/download`, or `…/releases/download/v<version>` with `--version`), and `SLICC_NODE_DIST_BASE` `https://nodejs.org/dist`, for mirrors and tests. `install.sh` fetches with `curl`, else `wget`, and checks checksums with `sha256sum`, else `shasum -a 256`; `install.ps1` uses `Invoke-WebRequest` and `Get-FileHash`. Without `--version`, the tarball is the `slicc-man-<version>.tgz` named in `SHA256SUMS`. A tarball whose checksum doesn't match is refused before anything is unpacked.

**Files.** The tarball is unpacked (with `tar`, `%SystemRoot%\System32\tar.exe` on Windows) into a temporary directory next to `<data>/<version>`, where `<data>` is `${XDG_DATA_HOME:-~/.local/share}/slicc-man`, or `%LOCALAPPDATA%\slicc-man` on Windows. A tarball that doesn't unpack exits 1 with `install.sh: could not unpack slicc-man-<version>.tgz` (or `install.ps1: could not unpack slicc-man-<version>.tgz`) and removes the partial directory. When its `package.json` has a non-empty `dependencies` or `optionalDependencies`, the installer removes `devDependencies` from that copy of `package.json`, then runs `npm install --omit=dev --ignore-scripts --no-audit --no-fund` there, with the npm that comes with the Node it picked, run by that Node (`<node dir>/../lib/node_modules/npm`, or `node_modules\npm` next to `node.exe`; `install.sh` falls back to `npm` on `PATH`), and npm's output on stderr. Without such dependencies, as slicc-man has none, the step is skipped and needs neither npm nor the network. A failed `npm install`, or a missing npm, exits 1 and removes the temporary directory, so a failed install never leaves a broken version behind. Only then does the directory replace `<data>/<version>`. Other versions stay where they are. Each launcher names its version's entry script, `<data>/<version>/host/scman.mjs`, and the Node it was installed with, by absolute path:

| platform | launcher in `DIR` | what it does |
| --- | --- | --- |
| macOS, Linux | `scman`, a POSIX sh script | sets and exports `SCMAN_INSTALL_DIR='<DIR>'`, exports `NODE_USE_ENV_PROXY=1` unless it is already set, then `exec '<node>' '<entry>' "$@"`; every path is single-quoted, so no path is ever evaluated |
| Windows | `scman.ps1` (UTF-8 with a BOM) | saves the caller's `$env:SCMAN_INSTALL_DIR` and sets it, sets `$env:NODE_USE_ENV_PROXY = '1'` when it is unset, runs `& '<node.exe>' '<entry>' @scmanArgs` in `try`, restores the old `SCMAN_INSTALL_DIR` in `finally` (or removes it when it was unset) and removes a `NODE_USE_ENV_PROXY` it set, then exits with node's exit code. A launcher whose `node.exe` can't start (deleted, or not a program) exits 1: it sets `$global:LASTEXITCODE = $null` before the call and keeps 1 when node left it unset, and a `catch` writes PowerShell's error to stderr with `Write-Error` and keeps 1, so neither the exit code of the caller's previous program nor a caller's `trap { continue }` makes it exit 0. A `.ps1` runs inside the caller's session, and this keeps the variables from leaking into it. `@scmanArgs` is `@args` with each array argument (`a,b`) flattened into separate arguments, as PowerShell passes them to a program, and each argument as text. When PowerShell passes arguments the legacy way, which drops empty arguments and doesn't escape `"` (Windows PowerShell 5.1 whatever `$PSNativeCommandArgumentPassing` says, `$PSNativeCommandArgumentPassing = 'Legacy'`, or pwsh before 7.3 without the variable; pwsh 7.3 and later without it pass the standard way), each `"` becomes `\"` (doubling the backslashes before it), an empty argument becomes `""`, and on Windows PowerShell an argument with whitespace gets its trailing backslashes doubled, so `node.exe` gets the arguments it was given. Since PowerShell reads an unquoted `a,b` as an array, `scman https://x/?a=1,2` reaches `scman` as two arguments, so quote any argument with a comma in it (`scman 'https://x/?a=1,2'`). It also sets `$PSNativeCommandUseErrorActionPreference = $false` and `$ErrorActionPreference = 'Continue'` in its own scope, so neither a caller's `$true` (pwsh 7.4 and later) nor, on Windows PowerShell 5.1, a caller's `'Stop'` with stderr redirected can turn node's exit code or its stderr into an error |
| Windows | `scman.cmd` (UTF-8, code page 65001 while it runs) | sets `SCMAN_INSTALL_DIR` and, when it is undefined, `NODE_USE_ENV_PROXY=1` (both local through `setlocal`), then runs `"<node.exe>" "<entry>" %* & call :done %%ERRORLEVEL%% & call exit /b %%ERRORLEVEL%%` as one line, so a `)` in an argument can't end anything early and a launcher `--upgrade` rewrites mid-run is never read again; `:done` restores the code page and returns node's status, and `call exit /b` exits with it explicitly, because a bare `exit /b` leaves the exit code of `cmd /c` (which PowerShell and every other program uses to run a `.cmd`) at 0. A `node.exe` that can't start leaves cmd's own non-zero code (9009 when it is missing). Arguments reach it through cmd's own parsing: `%`, `^`, `&` and `)` are safe inside `"…"`, and a `\"` inside one counts as a quote to cmd, so the quotes in an argument have to pair up |

Both Windows launchers only start `node.exe` with the entry script and the arguments. `NODE_USE_ENV_PROXY=1` makes Node's `fetch` (pages, the sitemap and `--upgrade`) honour `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` the way curl does. On Windows the installer adds `DIR` to the user's `PATH` when it isn't there already, and says so, along with the PowerShell command that removes it again (`To undo: [Environment]::SetEnvironmentVariable('Path', …, 'User')`). When `Get-ExecutionPolicy` is `Restricted`, `AllSigned` or `Undefined`, PowerShell won't run `scman.ps1`, so `install.ps1` prints to stderr that it needs `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or `scman.cmd` instead; it never changes the policy itself. Elsewhere it prints the `export PATH=…` line to add when `DIR` isn't on `PATH`. After writing the launchers, the installer runs `scman --version` and requires the version it installed, alone (`1.2.0`) or as `scman 1.2.0` from older releases, then prints `scman <version> installed to <launcher>` to stdout.

## man

```
man [options] [section] topic...
```

`man tree` shows the tree page. With several topics, `man` shows each in turn. A topic is looked up in lower case; `topic(1)` is the same as `1 topic`. When the first of two or more operands is a section name (a digit, or a digit and letters, as `3p`), it is the section. Every page is in section 1: a page asked for in any other section prints `No manual entry for <topic> in section <n>` to stderr, and with `-s`, the list as given. A topic that isn't a page name (empty, starting with `.`, or with anything but letters, digits, `.`, `_`, `+` and `-`) has no page, and nothing is fetched for it.

| option | does |
| --- | --- |
| `-s <list>`, `--sections=<list>` | the sections to look in, separated by `:` or `,` |
| `-k`, `--apropos` | `apropos` with the operands as keywords |
| `-f`, `--whatis` | `whatis` with the operands as topics |
| `-a`, `--all` | show every matching page; there is only ever one, so it changes nothing |
| `-w`, `--where`, `--path`, `--location` | print the page's URL, `https://www.sliccy.com/man/<topic>.md`, instead of showing it |
| `-P <pager>`, `--pager=<pager>` | the pager (see [Rendering](#rendering)) |
| `-l`, `--local-file` | render the operands, local Markdown files (`-` for stdin), as pages; the page's name is the file's, without `.md`, and `stdin` for `-` |
| `-i`, `--ignore-case` | the default |
| `-I`, `--match-case` | look the topic up as typed, not in lower case |
| `--nh`, `--no-hyphenation`, `--nj`, `--no-justification` | accepted; the renderer neither hyphenates nor justifies |
| `-h`, `--help` | the usage to stdout, exit 0 |
| `-V`, `--version` | the version alone (`1.2.0`) to stdout, exit 0; every host command takes it, and the installer runs the launcher with it |
| `--upgrade` | see [`--upgrade`](#--upgrade) |

Short options may be grouped (`-aw`). An option's value may be attached (`-s1`, `-Pcat`, `--pager=cat`) or the next argument; options may come after the operands, and `--` ends the options. Of `-k` and `-f`, the last one given counts, and so for `-i` and `-I`. With `-k` or `-f`, the operands are matched with `apropos`'s and `whatis`'s defaults, and only `-s` of the other options counts. `man` with no topic prints `What manual page do you want?` and `For example, try 'man man'.` to stderr and exits 2.

## apropos and whatis

```
apropos [options] keyword...
whatis [options] topic...
```

`apropos` searches the topics and descriptions, `whatis` the topics only. Each match is a line like man-db's: the topic and ` (1)` padded to 20 columns, ` - `, and the description, as in `tree (1)             - List contents of directories in a tree-like format.` Matches come in the sitemap's order, each once, and are case-insensitive.

| option | `apropos` | `whatis` |
| --- | --- | --- |
| none | each keyword is a regular expression (JavaScript syntax) matched anywhere in a topic or description | each topic must be a page name exactly |
| `-r`, `--regex` | the default | the topic is a regular expression matched anywhere in a page name |
| `-w`, `--wildcard` | each keyword is a shell wildcard (`*`, `?`, `[…]`) matched against a whole topic or a whole word of a description | the topic is a wildcard matched against a whole page name |
| `-e`, `--exact` | each keyword must be a whole topic or a whole word of a description | the default |
| `-a`, `--and` | a page must match every keyword, not any one | not taken |
| `-l`, `--long` | don't cut lines to the terminal width | the same |
| `-s <list>`, `--sections=<list>` | only those sections; without 1, nothing matches | the same |
| `-h`, `-V`, `--upgrade` | as for `man` | the same |

On a terminal, a line wider than the width (see [Rendering](#rendering)) is cut and ends in `...`; through a pipe it is whole. A keyword with no match prints `<keyword>: nothing appropriate.` to stderr. With `-a`, that is printed for the keywords together, when no page matches them all. A regular expression that doesn't parse is a usage error, `<cmd>: <keyword>: invalid regular expression`. With no keyword, `apropos` prints `apropos what?` (`whatis`: `whatis what?`) to stderr and exits 2; `man -k` and `man -f` do the same.

## Not supported

These man-db options can't work here. They print `<cmd>: <option>: not supported` to stderr and exit 2, before anything is fetched:

- **man:** `-t`/`--troff`, `-T`/`--troff-device`, `-H`/`--html`, `-X`/`--gxditview`, `-Z`/`--ditroff`, `-M`/`--manpath`, `-m`/`--systems`, `-L`/`--locale`, `-C`/`--config-file`, `-d`/`--debug`, `-D`/`--default`, `-W`/`--where-cat`, `-c`/`--catman`, `-u`/`--update`, `-e`/`--extension`, `-p`/`--preprocessor`, `-R`/`--recode`, `-E`/`--encoding`, `-K`/`--global-apropos`, `-r`/`--prompt`, `--regex`, `--wildcard`, `--names-only`, `--no-subpages`.
- **apropos, whatis:** `-M`/`--manpath`, `-m`/`--systems`, `-L`/`--locale`, `-C`/`--config-file`, `-d`/`--debug`, `-v`/`--verbose`.

Any other option, or an option without its value, prints `<cmd>: unknown option: <option>` (or `<cmd>: <option>: needs a value`) and the usage to stderr, and exits 2. So does `--upgrade` with anything else, as `<cmd>: --upgrade takes no other arguments`.

## Exit codes

| code | means |
| --- | --- |
| 0 | done |
| 1 | `--upgrade` on a host, when the installer fails |
| 2 | a usage error (`man` with no topic included), an option that isn't supported, or an operational error: the site unreachable with nothing cached, a pager that can't be run, a file `-l` can't read |
| 16 | at least one topic has no page, or one keyword matched nothing |

`man nope` prints `No manual entry for nope` to stderr and exits 16. With several topics, the others are still shown. `-w` exits 16 for a topic with no page too, printing the URLs of the others.

## Rendering

A page is turned from Markdown into a man page:

- **Header:** `TOPIC(1)`, `SLICC Manual` centred, `TOPIC(1)`, then a blank line.
- **NAME:** the first paragraph becomes `topic - description`, under `NAME`.
- **Sections:** each `##` heading is a section heading in capitals at the left margin (`## See Also` becomes `SEE ALSO`), and `###` a subheading indented 3 columns. The body is indented 7 columns and wrapped at the width.
- **Text:** `**strong**` and `` `code` `` are bold, `*emphasis*` and `_emphasis_` underlined. A link shows its text only, an image its alt text. Lists keep their marker with the item's lines hanging after it. Code blocks and tables are kept line for line, indented and never wrapped.
- **Escapes:** a backslash before ASCII punctuation is dropped, as Markdown does, which undoes the site's `\[`, `\<` and `\--`; inside code it stays.
- **Metadata:** the trailing table whose first row is `Metadata` is dropped.
- **Control characters:** none from a page reaches the terminal; they are dropped, except tabs, which become spaces.

The width is `MANWIDTH` when it is a positive number, else the terminal's width when stdout is a terminal, else 80.

When stdout is a terminal, bold and underline are ANSI escapes (`ESC[1m`, `ESC[4m`), unless `NO_COLOR` is set and not empty, and the page goes through a pager: `-P`, else `MANPAGER`, else `PAGER`, else `less -R` when `less` is on `PATH` (on Windows, `less` with an extension from `PATHEXT`, by default `.COM`, `.EXE`, `.BAT` or `.CMD`), else straight to stdout. The pager is a command line run by the shell (`/bin/sh -c`, or `%COMSPEC% /d /s /c "<pager> & if errorlevel 9009 if not errorlevel 9010 exit 9009"` on Windows, because the exit code of `cmd /c` alone doesn't say that it couldn't find the command), with the page on its stdin; an empty one means straight to stdout. A pager that exits non-zero doesn't change the exit code; one that can't be run (the shell's 126 or 127, or cmd's 9009 on Windows) is exit 2. When stdout isn't a terminal, the page is plain text, with no escapes and no pager. `apropos` and `whatis` never use a pager.

## Offline cache

Pages, the sitemap and the topic index are cached:

- on a host in `$XDG_CACHE_HOME/slicc-man`, by default `~/.cache/slicc-man`, and on Windows in `%LOCALAPPDATA%\slicc-man\cache`;
- in SLICC in `~/.cache/slicc-man`, which lives in OPFS, so it survives reloads.

Each site has its own directory in the cache, named by the base URL's host and port (`www.sliccy.com`, `127.0.0.1-8080`), with one JSON file per page, `sitemap.json` and `index.json`. A cached copy is fresh for the response's `Cache-Control` `max-age` (the site sends 4 hours), and 4 hours without one. A stale copy is revalidated with `If-Modified-Since` (the response's `Last-Modified`): `304` keeps it and makes it fresh again, `200` replaces it, and `404` drops it, so the topic has no page. When the site can't be reached, or answers 5xx, a cached copy is shown however old, after one line on stderr, `<cmd>: <url>: <reason>; showing the copy cached <date>`. With nothing cached, the command prints `<cmd>: <url>: <reason>` and exits 2. The cache is written atomically (a temporary file renamed into place), so two commands at once never see half a page; a cache that can't be written is skipped without a word.

`apropos` and `whatis` read the index: every `/man/<topic>` entry of the sitemap, with its description, the first paragraph of its page, rendered as plain text on one line. The index is built from the cached sitemap and pages, fetching what is missing or stale (pages through the same cache, several at a time), and cached itself under the same rules. A page that fails to load is listed without a description, and an index with a failed page isn't cached, so the next command tries that page again. After an HTTP error (a 404 or a 5xx), the other pages are still fetched; after a network error or a timeout, no more pages are fetched, and the rest come from the cache.

`SLICC_MAN_URL` overrides the base URL `https://www.sliccy.com`: pages are `$SLICC_MAN_URL/man/<topic>.md` and the sitemap `$SLICC_MAN_URL/sitemap.xml`, whose entries count by their path, whatever their host. The tests point it at a local server.

## Fallback

In SLICC only: when a topic has no page and is a command on `PATH`, `man` prints `No manual entry for <topic>; showing <topic> --help` to stderr, then the output of `<topic> --help` (stdout and stderr together, as plain text with its escape sequences and other control characters dropped, through the pager when stdout is a terminal), and that topic counts as found, so `man` can exit 0. seven's own commands often have no page yet. The fallback doesn't apply to a section other than 1, `-w`, `-k`, `-f` or `-l`. On a host there is no fallback; the host has its own `man`.

## `--upgrade`

Every host command takes `--upgrade`. It runs the latest release's installer (`install.sh`, or `install.ps1` on Windows) with `--dir` set to the directory the command is installed in, so the new version replaces the old one in place, then prints `<cmd>: <old> → <new>` (for example `scman: 1.2.0 → 1.3.0`), or `<cmd>: already up to date (<version>)`, to stdout and exits 0. If the installer fails, its stderr is passed through and the command exits 1. A command installed with npm prints `npm install -g @ai-ecoverse/slicc-man@latest` to run instead, and exits 0. In SLICC, `--upgrade` prints `pnpm add -g @ai-ecoverse/slicc-man@latest` to run, and exits 0; it installs nothing itself. `--upgrade` takes no other arguments.

The commands are `scman` on a host and `man`, `apropos`, `whatis` and `scman` in SLICC.

The launcher the installer writes sets `SCMAN_INSTALL_DIR` to its own directory; that is how `scman` knows the installer put it there (it removes the variable before it starts a pager or the installer), and without it `scman` counts as installed with npm. The installer is downloaded from `https://github.com/ai-ecoverse/slicc-man/releases/latest/download/` into a temporary directory and run as `sh install.sh --dir DIR`, or `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File install.ps1 -Dir DIR` (else `pwsh.exe`) without `PSModulePath` in its environment, with its stderr passed through. (Run from PowerShell 7, `scman` inherits pwsh's `PSModulePath`, and Windows PowerShell started with it loses `Get-FileHash`.) `--upgrade` goes on once the installer has exited, waiting at most 500 ms more for its stdout, so a process the installer left running can't hold it. The line the installer prints, `scman <version> installed to <launcher>`, names the new version. A download that fails is the installer failing: `<cmd>: could not download <url>: <reason>` (an HTTP error status prints `<cmd>: could not download <url>: HTTP <status>`, and its body is cancelled, not left open), exit 1, and so is an installer that doesn't print that line (`<cmd>: install.sh did not say which version it installed`) or a missing `sh` or PowerShell (`<cmd>: no shell found to run install.ps1 (tried powershell.exe, pwsh.exe)`). The download has 60 seconds; after that `--upgrade` prints `<cmd>: download timed out` to stderr and exits 1. `SLICC_INSTALL_BASE_URL`, when set, replaces that release URL for `--upgrade` and for the installers' own downloads.

## Platforms

| platform | commands | cache | pager | network |
| --- | --- | --- | --- | --- |
| SLICC | `man`, `apropos`, `whatis`, `scman` | `~/.cache/slicc-man`, in OPFS | `less -R` (seven's `less`) | the kernel's network transport |
| macOS | `scman` | `$XDG_CACHE_HOME/slicc-man`, else `~/.cache/slicc-man` | `less -R` | direct HTTPS |
| Linux | `scman` | `$XDG_CACHE_HOME/slicc-man`, else `~/.cache/slicc-man` | `less -R` when installed, else stdout | direct HTTPS |
| Windows | `scman` (`scman.ps1`, `scman.cmd`) | `%LOCALAPPDATA%\slicc-man\cache` | `less -R` through `cmd /c` when on `PATH` (Git for Windows has one), else stdout | direct HTTPS |

`scman -k` and `scman -f` are its `apropos` and `whatis`. Other Unix systems are treated as Linux.

## Development

```sh
npm install
npm run lint
npm test
npm run test:unit
```

- `npm run lint`: Biome, the no-comment check and the other [slicc-shared-web](https://github.com/ai-ecoverse/slicc-shared-web) checks, then `shellcheck -s sh` and `dash -n` on `install.sh`.
- `npm test`: the integration tests in `test/integration/`. `slicc.test.mjs` installs the files `npm pack` ships into a headless slicc-kernel in Node (`createNodeKernel`, with wasm-bash and wasm-coreutils), and runs `man`, `apropos`, `whatis` and `scman` there against a local HTTP server on an ephemeral port, reached through the kernel's network transport as `http://host.slicc.internal:<port>` (`SLICC_MAN_URL`), with fake `less` and `hello` commands on `PATH` and a terminal from `openTerminal` for the pager. `host.test.mjs` runs `scman` (in-process, so a terminal can be faked, and as `host/scman.mjs`) against a local HTTP server on an ephemeral port standing in for www.sliccy.com (`SLICC_MAN_URL`), serving copies of the site's `tree.md` and `man.md` (`pages.json`, with their expected renderings), with a temporary cache and fake tools, `less`, `cmd` and `powershell.exe` among them, on a temporary `PATH`, and `win32` forced for the Windows lookup, pager, cache and `--upgrade` checks, so they run on any machine; only CI touches the real site. A fake is a Node script; on Windows it is a copy of a small `.exe` that `csc.exe` builds from C# (`fake-windows.mjs`), which runs the fake's script with Node, so there the Windows branches run for real, the pager through the real `cmd.exe`. `install.test.mjs` runs `scripts/assets.mjs` and `install.sh` on a tarball packed from the tree, with the Node on `PATH` and with a Node download from a fake nodejs.org, without `HOME`, with dependencies for npm to install, a truncated tarball and Node archive whose checksums match, and `--upgrade` against a release served from a local server; `install.ps1` is checked statically, and run when `pwsh` is on `PATH`, where a strict caller (`$PSNativeCommandUseErrorActionPreference = $true`, `$ErrorActionPreference = 'Stop'`), the launchers' environment and the argument passing of `scman.ps1` (hard arguments and `a,'b c' d`, under Standard, Legacy and no `$PSNativeCommandArgumentPassing`) are checked through a copy whose entry script prints its argv, and a `scman.ps1` pointed at a `node` that is missing or isn't a program must exit 1. `repo.test.mjs` checks the workflow, the release config, the package's shape, what `npm pack` ships and the repo rules.
- `npm run test:windows`: on Windows, the host tests and `windows.test.mjs`, which installs a tarball packed from the tree with `install.ps1` under both Windows PowerShell and `pwsh`, from a local HTTP server into a temporary `-Dir`; runs `scman.cmd` and `scman.ps1` with `--version`, `--help`, a usage error and a page from a local site, cached in `%LOCALAPPDATA%\slicc-man\cache`; passes arguments full of `)`, `&`, `%`, `^`, spaces and quotes through copies of both launchers whose entry script prints its argv; checks that neither leaks `SCMAN_INSTALL_DIR` or `NODE_USE_ENV_PROXY`, that both exit non-zero (the `.ps1` exits 1, after a program that exited 0, for a default, a strict, a `trap { continue }` and a redirected-stderr caller) once the copied `node.exe` they were installed with is replaced by a file that isn't a program and then deleted, that the `.cmd` keeps the exit code and restores the code page, and that the printed PATH undo works; upgrades in place with `--upgrade`, from a `cmd` that has pwsh's `PSModulePath`; and downloads Node as a `.zip` from a fake nodejs.org, after refusing a truncated one; the installs and `scman.ps1` run under a strict caller too, and a truncated tarball exits 1 there. Elsewhere `windows.test.mjs` is skipped.
- `npm run test:unit`: the unit tests in the gitignored `test/unit/`, with Node's coverage in `coverage/unit/lcov.info`. The pre-commit hook wants 100% coverage of the changed lines.

CI is `.github/workflows/ci.yml`, the only workflow, which runs [slicc-shared-web's pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline) at the devDependency's version, with Node 26, which the headless kernel needs: `npm run lint`, then `npm test` on Linux, and on a pull request and in the merge queue `npm run test:windows` on `windows-latest` (`windows-test` in `ci.yml`), then on a pull request the Claude and Codex reviews. The merge queue requires `ci / integration` and `ci / review`. On a push to `main`, semantic-release releases and publishes to npm through trusted publishing, with provenance from `ci.yml`, and attaches `slicc-man-<version>.tgz`, `SHA256SUMS`, `install.sh` and `install.ps1` to the GitHub release (see [the installer](#the-installer)).

The code is in `lib/` (options, the Markdown renderer, the cache and index, apropos and whatis, shared with SLICC), `host/` (`scman.mjs`, the cache directory, the pager, `--upgrade`) and `slicc/` (`main.mjs`, the JS ABI entry: the cache in `~/.cache/slicc-man` through the kernel's file system, `fetch`, the pager, the fallback and `--upgrade`). `scripts/bundle.mjs` bundles `slicc/main.mjs` and `lib/` with esbuild into `dist/slicc.mjs`, the module `slicc.commands` names, with only the version of `package.json` in it. `dist/` is a build output, not in git: `npm pack` and `npm publish` build it (`prepack`), so a release always ships a bundle of its own sources, and `slicc.test.mjs` and `repo.test.mjs` check what `npm pack` ships.

## License

Apache-2.0
