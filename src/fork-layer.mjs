import { EntryTree, EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import { Service } from '@deepseek-ai/cordis'

// Own a real resolution tree: Loader import and Client metadata both read
// entry.parent.tree.ctx.baseUrl. A Group alone reuses its parent's tree.
// This layer owns no UI, layout, Pin or Session state and writes no config file.
export default class BundledForkLayer extends EntryTree {
  static readonly = true
  static [EntryGroup.key] = true

  constructor(ctx, config) {
    super(ctx)
    this.ctx.baseUrl = new URL('../', import.meta.url).href
    this.config = config
    this.ctx.on('internal/update', next => this.root.update(next))
  }

  async* [Service.init]() {
    yield () => this.root.stop()
    await this.root.update(this.config)
  }

  write() {}
}
