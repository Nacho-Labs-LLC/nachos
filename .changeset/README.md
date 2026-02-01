# Changesets

This directory contains changesets for the Nachos monorepo.

## What is a changeset?

A changeset is a piece of information about changes made in a branch or commit. It holds three key bits of information:

1. What packages need to be released
2. What version they need to be released at (using a [semver bump type](https://semver.org/))
3. A changelog entry for the released packages

## How to add a changeset

Run `pnpm changeset` in the root of the repository and follow the prompts.

## How to release

1. Create changesets for your changes: `pnpm changeset`
2. Version packages: `pnpm changeset:version`
3. Publish packages: `pnpm changeset:publish`

For more information, see [Changesets documentation](https://github.com/changesets/changesets).
