---
"@stratum-hq/mongodb": minor
---

Fix `stratumPlugin` document writes and support Mongoose 9.

- `Model.create()` and `new Model().save()` in a tenant context now work. The plugin sets `tenant_id` in a `pre('validate')` hook, because Mongoose validates the required field before the `pre('save')` hooks run.
- The plugin hooks now work on Mongoose 9, which calls pre hooks without a `next` callback. Before, `insertMany()`, `save()` and `bulkWrite()` threw on Mongoose 9.
- `package.json` now declares the supported Mongoose versions as an optional peer dependency: `"mongoose": "^8.0.0 || ^9.0.0"`. npm warns when an application installs a different major version.

This is a minor release because the new peer range adds Mongoose 9 support.
