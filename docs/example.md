# Volumes

OPFS-powered virtual file system extension for TurboWarp and compatible Scratch mods.

## Overview

Volumes gives your Scratch projects persistent, sandboxed file storage through the browser's
[Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
(OPFS) API. Files written with this extension survive page reloads and are private to the
origin they were created on.

## Blocks

### write \[CONTENT\] to \[PATH\] in OPFS

Writes a text string to a file. Intermediate directories are created automatically.

| Argument  | Type   | Default    | Description                       |
| --------- | ------ | ---------- | --------------------------------- |
| `CONTENT` | string | `hello`    | Text to write into the file.      |
| `PATH`    | string | `file.txt` | POSIX-style path relative to the OPFS root. |

### read \[PATH\] from OPFS

Reads and returns the text content of a file. Returns an empty string when the file
does not exist.

| Argument | Type   | Default    | Description                       |
| -------- | ------ | ---------- | --------------------------------- |
| `PATH`   | string | `file.txt` | POSIX-style path of the file to read. |

### delete \[PATH\] from OPFS

Deletes a file. Does nothing when the file does not exist.

| Argument | Type   | Default    | Description                       |
| -------- | ------ | ---------- | --------------------------------- |
| `PATH`   | string | `file.txt` | POSIX-style path of the file to delete. |

### \[PATH\] exists in OPFS

Reports `true` when the file at `PATH` exists, otherwise `false`.

| Argument | Type   | Default    | Description                       |
| -------- | ------ | ---------- | --------------------------------- |
| `PATH`   | string | `file.txt` | POSIX-style path to check.        |

### list files in \[DIR\] in OPFS

Returns a JSON array of entry names (files and subdirectories) inside a directory,
sorted alphabetically. Returns `[]` when the directory does not exist.

| Argument | Type   | Default | Description                                 |
| -------- | ------ | ------- | ------------------------------------------- |
| `DIR`    | string | `/`     | Directory path. Use `/` for the OPFS root.  |

### create directory \[DIR\] in OPFS

Creates a directory, including all intermediate directories. Does nothing when the
directory already exists.

| Argument | Type   | Default    | Description                       |
| -------- | ------ | ---------- | --------------------------------- |
| `DIR`    | string | `myfolder` | POSIX-style path of the directory to create. |

### delete directory \[DIR\] from OPFS

Recursively deletes a directory and all its contents. Does nothing when the
directory does not exist.

| Argument | Type   | Default    | Description                         |
| -------- | ------ | ---------- | ----------------------------------- |
| `DIR`    | string | `myfolder` | POSIX-style path of the directory to delete. |

## Notes

- All paths use forward slashes (`/`) as separators regardless of platform.
- OPFS storage is scoped to the page origin and is not accessible from other websites.
- OPFS is a browser-only API. The extension will not function outside a browser environment.
- The extension runs unsandboxed to access `navigator.storage`.

