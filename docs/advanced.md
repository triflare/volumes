# Advanced Notes

This page covers the parts of Volumes that are most useful once you are comfortable with the basic blocks.

## RAM versus OPFS

RAM volumes are best for temporary data, scratch space, and tests. They are fast, but the contents disappear when the page reloads.

OPFS volumes are best when you want data to stay available after reloads. They rely on browser support for the Origin Private File System.
Volumes now fails fast during initialization when OPFS is unavailable, the context is insecure, or it is running inside a sandboxed frame. In browser contexts where `alert()` is available, it also displays an alert message before failing.

## Permissions

Every path can have its own permissions.

A few things to keep in mind:

- Permissions default to allowed.
- Write permission is used for changing existing files.
- Create permission is used when a new file or folder must be created.
- View permission controls whether something appears in folder listings.
- Control permission is required before changing permissions.

If a path does not exist, checking its permission returns false.

## Limits

RAM volumes come with default limits so they do not grow without bound:

- Size limit: 10 MB
- File count limit: 10,000

You can change these limits with the matching blocks.

These limits are checked when files are written or appended. Replacing a file only counts the size change, not the full file size again.

## Import and export

Export is useful for saving a whole volume structure in one JSON string.

Import is useful for restoring a volume later or copying it to another volume.

A few important details:

- Imported data restores files, folders, permissions, and limits.
- The target volume is formatted first.
- You can export all mounted volumes at once.
- If you want to import into a different volume name, update the JSON key to match the destination volume.

## Transactions

Transactions let you stage multiple changes and then either keep or discard them:

- Begin a transaction before a sequence of risky writes or deletes.
- Commit when all operations succeed.
- Roll back to restore the exact pre-transaction state.

Transactions are tracked per volume and only one transaction can be active per volume at a time.
The pre-transaction state is exported and kept in memory (same mechanism as snapshots), so active transactions on large volumes can consume comparable memory. Keep transactions small or commit frequently, and see the Snapshots section below for related memory details and limits.

## Snapshots

Snapshots are named restore points for a volume:

- Create a snapshot before migrations or large imports.
- Restore any saved snapshot later.
- Delete snapshots you no longer need.
- Diff two snapshots to see added, removed, and changed paths.

Snapshots are stored in-memory for the current extension session. To avoid unbounded memory use, snapshots are capped per volume (default `25`, configurable in code via `_maxSnapshotsPerVolume`). When the cap is reached, creating a new snapshot with a new name returns a quota error until you delete older snapshots.
Transactions use the same in-memory export format and also enforce a transaction snapshot size limit (default `50 MB`, configurable in code via `_maxTransactionSnapshotBytes`).

## Watchers and events

Watchers provide a polling-based event stream for filesystem activity:

- Watch a path with immediate or recursive depth.
- Poll by watcher ID to get new events since the previous poll.
- Unwatch when no longer needed.

Events are emitted for writes, appends, deletes, permission changes, format/import operations, and transaction lifecycle changes.
Event history is also bounded in-memory (default `1000`, configurable in code via `_maxEventLogEntries`) and older events are pruned as watchers advance, so stale subscribers should poll regularly.

## File details

When you write a Data URI, the extension keeps the MIME type if one is provided.

When you read back as Data URI, the output is always base64 encoded.

Deleting a folder removes everything under it.

## Good habits

If you are building a project around Volumes, it helps to:

- Keep temporary files in `tmp://`.
- Use `fs://` when you want persistence.
- Check permissions before trying to modify a path.
- Format a volume when you want to reset a project cleanly.
