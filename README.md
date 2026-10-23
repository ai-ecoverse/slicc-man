# slicc-man

`man`, `apropos` and `whatis` for SLICC, and `scman` for SLICC, macOS, Linux and Windows. They show the pages www.sliccy.com already serves: a page is the Markdown at `https://www.sliccy.com/man/<topic>.md`, the topics are the `/man/*` entries of [`sitemap.xml`](https://www.sliccy.com/sitemap.xml), and a page's one-line description is its first paragraph. The package renders the Markdown itself, so it needs no `man`, groff or mandoc on the host, and keeps what it fetched in an [offline cache](#offline-cache).

In SLICC, the commands are `man`, `apropos`, `whatis` and `scman`, which is `man` under another name. On a host only `scman` is installed, so the host's own `man` is never shadowed.

## Install

In SLICC, the package declares its commands in `slicc.commands`, so installing it puts them in `/usr/bin`:

```sh
pnpm add -g @ai-ecoverse/slicc-man
```

On macOS and Linux (get.sliccy.ai, once live):

```sh
curl -fsSL https://get.sliccy.ai/man | sh
```

On Windows, in PowerShell (get.sliccy.ai, once live):

```powershell
irm https://get.sliccy.ai/man.ps1 | iex
```

The same installers are attached to every GitHub release, as `install.sh` and `install.ps1`:

```sh
curl -fsSL https://github.com/ai-ecoverse/slicc-man/releases/latest/download/install.sh | sh
```

They install the release's `scman` with a launcher in `~/.local/bin` (on Windows `%LOCALAPPDATA%\slicc-man\bin`, added to the user's `PATH`), and download Node 24 into the install when no Node 24 or later is on `PATH` (the `.tar.gz`, or the `.zip` on Windows), checked against nodejs.org's `SHASUMS256.txt`. Each release also carries the package tarball, `slicc-man-<version>.tgz`, and `SHA256SUMS`, which covers the tarball, `install.sh` and `install.ps1`: the installers check the tarball against it, unpack it into `${XDG_DATA_HOME:-~/.local/share}/slicc-man/<version>` (on Windows `%LOCALAPPDATA%\slicc-man\<version>`), write the launcher (`scman`, or `scman.ps1` and `scman.cmd` on Windows, which only start `node.exe` with the entry script and the arguments, the node call and its `exit` on one line of the `.cmd`), run it with `--version` (the version alone, or `scman <version>` from older releases), and print `scman <version> installed to <launcher>`. Options pass through (`curl -fsSL https://get.sliccy.ai/man | sh -s -- --help`): `--version <version>` installs that release instead of the latest, `--dir <dir>` puts the launcher in `<dir>`, and `--help` prints the usage; `install.sh` exits 2 for an unknown option or one without its value. `install.ps1` takes the same options, spelled `-Version`, `-Dir` and `-Help`. `SLICC_INSTALL_BASE_URL` replaces the directory the assets are downloaded from (by default `https://github.com/ai-ecoverse/slicc-man/releases/latest/download`, or `…/releases/download/v<version>` with `--version`), and `SLICC_NODE_DIST_BASE` nodejs.org, for mirrors and tests.

On a machine with Node 24 or later, npm works too:

```sh
npm install -g @ai-ecoverse/slicc-man
scman tree
```

or without installing, `npx -p @ai-ecoverse/slicc-man scman tree`. The package's `bin` has only `scman`.

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

When stdout is a terminal, bold and underline are ANSI escapes (`ESC[1m`, `ESC[4m`), unless `NO_COLOR` is set and not empty, and the page goes through a pager: `-P`, else `MANPAGER`, else `PAGER`, else `less -R` when `less` is on `PATH`, else straight to stdout. The pager is a command line run by the shell (`sh -c`, `cmd /c` on Windows), with the page on its stdin; an empty one means straight to stdout. A pager that exits non-zero doesn't change the exit code; one that can't be run is exit 2. When stdout isn't a terminal, the page is plain text, with no escapes and no pager. `apropos` and `whatis` never use a pager.

## Offline cache

Pages, the sitemap and the topic index are cached:

- on a host in `$XDG_CACHE_HOME/slicc-man`, by default `~/.cache/slicc-man`, and on Windows in `%LOCALAPPDATA%\slicc-man\cache`;
- in SLICC in `~/.cache/slicc-man`, which lives in OPFS, so it survives reloads.

Each site has its own directory in the cache, named by the base URL's host and port (`www.sliccy.com`, `127.0.0.1-8080`), with one JSON file per page, `sitemap.json` and `index.json`. A cached copy is fresh for the response's `Cache-Control` `max-age` (the site sends 4 hours), and 4 hours without one. A stale copy is revalidated with `If-Modified-Since` (the response's `Last-Modified`): `304` keeps it and makes it fresh again, `200` replaces it, and `404` drops it, so the topic has no page. When the site can't be reached, or answers 5xx, a cached copy is shown however old, after one line on stderr, `<cmd>: <url>: <reason>; showing the copy cached <date>`. With nothing cached, the command prints `<cmd>: <url>: <reason>` and exits 2. The cache is written atomically (a temporary file renamed into place), so two commands at once never see half a page; a cache that can't be written is skipped without a word.

`apropos` and `whatis` read the index: every `/man/<topic>` entry of the sitemap, with its description, the first paragraph of its page, rendered as plain text on one line. The index is built from the cached sitemap and pages, fetching what is missing or stale (pages through the same cache, several at a time), and cached itself under the same rules. A page that fails to load is listed without a description.

`SLICC_MAN_URL` overrides the base URL `https://www.sliccy.com`: pages are `$SLICC_MAN_URL/man/<topic>.md` and the sitemap `$SLICC_MAN_URL/sitemap.xml`, whose entries count by their path, whatever their host. The tests point it at a local server.

## Fallback

In SLICC only: when a topic has no page and is a command on `PATH`, `man` prints `No manual entry for <topic>; showing <topic> --help` to stderr, then the output of `<topic> --help` (stdout and stderr together, as plain text, through the pager when stdout is a terminal), and that topic counts as found, so `man` can exit 0. seven's own commands often have no page yet. The fallback doesn't apply to a section other than 1, `-w`, `-k`, `-f` or `-l`. On a host there is no fallback; the host has its own `man`.

## `--upgrade`

Every host command takes `--upgrade`. It runs the latest release's installer (`install.sh`, or `install.ps1` on Windows) with `--dir` set to the directory the command is installed in, so the new version replaces the old one in place, then prints `<cmd>: <old> → <new>` (for example `scman: 1.2.0 → 1.3.0`), or `<cmd>: already up to date (<version>)`, to stdout and exits 0. If the installer fails, its stderr is passed through and the command exits 1. A command installed with npm prints `npm install -g @ai-ecoverse/slicc-man@latest` to run instead, and exits 0. In SLICC, `--upgrade` prints `pnpm add -g @ai-ecoverse/slicc-man@latest` to run, and exits 0; it installs nothing itself. `--upgrade` takes no other arguments.

The commands are `scman` on a host and `man`, `apropos`, `whatis` and `scman` in SLICC.

The launcher the installer writes sets `SCMAN_INSTALL_DIR` to its own directory; that is how `scman` knows the installer put it there (it removes the variable before it starts a pager or the installer), and without it `scman` counts as installed with npm. The installer is downloaded from `https://github.com/ai-ecoverse/slicc-man/releases/latest/download/` and run as `sh install.sh --dir DIR`, or `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File install.ps1 -Dir DIR` (else `pwsh.exe`); the line it prints, `scman <version> installed to <launcher>`, names the new version. A download that fails is the installer failing: `<cmd>: could not download <url>: <reason>`, exit 1. The download has 60 seconds; after that `--upgrade` prints `<cmd>: download timed out` to stderr and exits 1. `SLICC_INSTALL_BASE_URL`, when set, replaces that release URL for `--upgrade` and for the installers' own downloads.

## Platforms

| platform | commands | cache | pager | network |
| --- | --- | --- | --- | --- |
| SLICC | `man`, `apropos`, `whatis`, `scman` | `~/.cache/slicc-man`, in OPFS | `less -R` (seven's `less`) | the kernel's network transport |
| macOS | `scman` | `$XDG_CACHE_HOME/slicc-man`, else `~/.cache/slicc-man` | `less -R` | direct HTTPS |
| Linux | `scman` | `$XDG_CACHE_HOME/slicc-man`, else `~/.cache/slicc-man` | `less -R` when installed, else stdout | direct HTTPS |
| Windows | `scman` | `%LOCALAPPDATA%\slicc-man\cache` | `less -R` when on `PATH` (Git for Windows has one), else stdout | direct HTTPS |

`scman -k` and `scman -f` are its `apropos` and `whatis`. Other Unix systems are treated as Linux.

## Development

```sh
npm install
npm run lint
npm test
npm run test:unit
```

- `npm run lint`: Biome, the no-comment check and the other [slicc-shared-web](https://github.com/ai-ecoverse/slicc-shared-web) checks, then `shellcheck -s sh` and `dash -n` on `install.sh`.
- `npm test`: the integration tests in `test/integration/`. `host.test.mjs` runs `scman` (in-process, so a terminal can be faked, and as `host/scman.mjs`) against a local HTTP server on an ephemeral port standing in for www.sliccy.com (`SLICC_MAN_URL`), serving copies of the site's `tree.md` and `man.md` (`pages.json`, with their expected renderings), with a temporary cache and fake tools, `less` among them, on a temporary `PATH`; only CI touches the real site. `install.test.mjs` runs `install.sh` on a tarball packed from the tree, with the Node on `PATH` and with a Node download from a fake nodejs.org, and `--upgrade` against a release served from a local server; `install.ps1` is checked statically, and run when `pwsh` is on `PATH`. `repo.test.mjs` checks the workflow, the release config, the package's shape, what `npm pack` ships and the repo rules.
- `npm run test:unit`: the unit tests in the gitignored `test/unit/`, with Node's coverage in `coverage/unit/lcov.info`. The pre-commit hook wants 100% coverage of the changed lines.

CI is `.github/workflows/ci.yml`, the only workflow, which runs [slicc-shared-web's pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline) at the devDependency's version, on Linux only: `npm run lint`, then `npm test`, then on a pull request the Claude and Codex reviews. The merge queue requires `ci / integration` and `ci / review`. On a push to `main`, semantic-release releases and publishes to npm through trusted publishing, with provenance from `ci.yml`, and attaches `slicc-man-<version>.tgz`, `SHA256SUMS`, `install.sh` and `install.ps1` to the GitHub release (`scripts/assets.mjs` renames the tarball and writes `SHA256SUMS`).

The code is in `lib/` (options, the Markdown renderer, the cache and index, apropos and whatis, shared with SLICC) and `host/` (`scman.mjs`, the cache directory, the pager, `--upgrade`).

## License

Apache-2.0
