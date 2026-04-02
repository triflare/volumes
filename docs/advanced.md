# Advanced Notes

This page covers the parts of Volumes that are most useful once you are comfortable with the basic blocks.

## RAM versus OPFS

RAM volumes are best for temporary data, scratch space, and tests. They are fast, but the contents disappear when the page reloads.

OPFS volumes are best when you want data to stay available after reloads. They rely on browser support for the Origin Private File System.

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
