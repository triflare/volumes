<p align="center">
  <img src="src/assets/icon.svg" alt="Volumes logo" width="100">
</p>

# Introduction to Volumes

Volumes is an OPFS-powered custom extension for TurboWarp and other Scratch mods that allows you to use a custom, virtual file system in your projects.

Imagine if Windows and Linux's file systems had a date, talked about their advantages and disadvantages, and eventually had a baby. **That baby will be Volumes.**

## Primary features

- **Based on Mint:** Volumes' source code uses the Mint tooling, meaning it'll be rock-hard and easy to maintain in the future.
- **OPFS-powered:** Not only does this mean Volumes will be stable, it will also be secure. OPFS file systems can only be accessed in the domain they are created in!
- **Persistent:** Whatever changes you make to an OPFS volume _(like the `fs://` volume you start out with)_ will stay after a reload. However, temporary volumes _(like the `tmp://` volume you also start with)_ do not.

## Documentation

If you want a more practical guide, start with the docs in [docs/example.md](docs/example.md).

- [Using Volumes](docs/using-volumes.md)
- [Block Reference](docs/reference.md)
- [Advanced Notes](docs/advanced.md)
