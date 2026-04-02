# Using Volumes

Volumes gives you a private file system inside TurboWarp or another Scratch mod. It is meant to feel like working with folders and files, without leaving your project.

## What you start with

When the extension loads, you usually have at least one volume ready to use:

- `tmp://` is a RAM volume. It is temporary and resets when the page reloads.
- `fs://` is an OPFS volume when the browser supports it. It is persistent and keeps its contents after reloads.

If a volume name does not end in `://`, the extension adds it for you.

## Common block flow

A typical project uses these blocks in this order:

1. Mount a volume if you need one that is not already there.
2. Write files or append to them.
3. Read files back as text or Data URI.
4. List folders to see what is inside.
5. Delete files or format a volume when you want a clean slate.

## Writing files

Use the write block to create a file or replace what is already there.

- Writing to a new file creates any missing parent folders.
- Writing to an existing file keeps that file's permissions.
- Writing to the root of a volume is not allowed.

If you need to add to the end of a file, use append instead of write.

## Reading files

You can read a file as plain text or as a Data URI.

- Text is the simplest option for Scratch strings.
- Data URI is useful when you want to preserve MIME type information.

Reading a folder returns an empty result and records the error in the last error block.

## Organizing files

Folders are created automatically when needed. That makes it easy to write to paths like `tmp://notes/todo.txt` without creating each folder by hand.

To see what is inside a folder, use list files.

- Immediate lists only the direct children.
- All lists everything below that folder.

If you only want to know whether something exists, use path check.

## Cleaning up

Use delete path to remove a file or a whole folder tree.

Use format volume when you want to erase everything in a volume and start again. This resets the content, size, and file count for that volume.
