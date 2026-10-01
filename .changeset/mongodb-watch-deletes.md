---
"@stratum-hq/mongodb": minor
---

The scoped `watch()` of `stratumPlugin` can now deliver delete events. Pass `{ watchDeletes: true }` to the plugin. The stream then reads the tenant of a delete event from its change stream pre-image, and delivers the event only to the tenant that owned the document. The option needs MongoDB 6.0 or later and `changeStreamPreAndPostImages` enabled on the collection. If the collection has no pre-images, the stream emits a clear error and closes. Without the option, the behavior does not change.
