# Block Reference

This page gives a simple reference for the extension's blocks.

## Volume blocks

### mount [VOL] as [TYPE]

Creates a new volume or replaces an existing one with the same name.

- `TYPE` can be `RAM` or `OPFS`.
- RAM volumes are temporary.
- OPFS volumes use the browser's persistent storage when available.

### format volume [VOL]

Deletes the contents of a volume and resets its size and file count.

### list mounted volumes

Returns a JSON list of all mounted volume names.

### set size limit of [VOL] to [LIMIT] bytes

Sets the maximum total file size for a volume.

### set file count limit of [VOL] to [LIMIT]

Sets the maximum number of files in a volume.

## File operations

### [MODE] [STRING] to [PATH]

Writes or appends text or Data URI content to a file.

- `write` creates or replaces a file.
- `append` adds to the end of a file.

### read [PATH] as [FORMAT]

Reads a file.

- `text` returns a normal string.
- `Data URI` returns a base64 Data URI.

### delete [PATH]

Deletes a file or folder.

## Path and folder blocks

### list [DEPTH] files in [PATH]

Lists folder contents.

- `immediate` shows only direct children.
- `all` shows everything below the folder.

### [PATH] [CONDITION]?

Checks a path.

- `exists` returns whether the path is present.
- `is a directory` returns whether the path is a folder.

### join path [P1] and [P2]

Combines two path pieces into one path.

## Permissions blocks

### set [PERM] permission of [PATH] to [VALUE]

Changes the permission for a file, folder, or volume root.

- `PERM` can be `read`, `write`, `create`, `view`, `delete`, or `control`.
- `VALUE` can be `allow` or `deny`.

### [PATH] allows [PERM]?

Checks whether a path currently allows a permission.

## Import and export blocks

### export [VOL] as JSON

Exports one volume or all mounted volumes to JSON.

### import JSON [JSON] to [VOL]

Imports a previously exported JSON structure into a volume.

## Transaction blocks

### begin transaction [TXN] on [VOL]

Starts a transaction snapshot for a volume.

### commit transaction on [VOL]

Commits an active transaction on a volume.

### rollback transaction on [VOL]

Restores the volume state captured when the active transaction started.

### list active transactions

Returns a JSON list of active transactions.

## Snapshot blocks

### create snapshot [SNAP] of [VOL]

Creates a named snapshot for a volume.

### restore snapshot [SNAP] on [VOL]

Restores a previously created named snapshot.

### diff snapshots [A] and [B] on [VOL]

Returns a JSON diff with added, removed, and changed paths.

### list snapshots on [VOL]

Returns a JSON list of snapshot names for the volume.

## Watcher blocks

### watch [PATH] depth [DEPTH]

Creates a watcher and returns a watcher ID.

- `DEPTH` can be `immediate` or `all`.

### unwatch [WATCHER]

Stops a watcher by its watcher ID.

### poll events for [WATCHER]

Returns new watcher events as JSON since the last poll.

## Diagnostics blocks

### last error

Returns the most recent status from the extension as JSON.

### run integrity test

Runs an internal self-check across common volume actions.
