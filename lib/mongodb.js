import { MongoClient } from 'mongodb';

const collectionNames = [
  'admins',
  'categories',
  'links',
  'login_attempts',
  'settings',
  'search_engines',
];

export async function createMongodb(config) {
  const client = new MongoClient(config.uri);
  await client.connect();
  const db = client.db(config.database);
  const collections = Object.fromEntries(
    collectionNames.map((name) => [name, db.collection(name)]),
  );
  const counters = db.collection('_counters');
  await Promise.all([
    collections.admins.createIndex({ username: 1 }, { unique: true }),
    collections.settings.createIndex({ key: 1 }, { unique: true }),
    collections.links.createIndex({ category_id: 1 }),
    collections.login_attempts.createIndex({ username: 1, attempted_at: 1 }),
  ]);

  const nextId = async (name) => {
    const counter = await counters.findOneAndUpdate(
      { _id: name },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false },
    );
    return counter.value;
  };
  const withoutMongoId = (document) => {
    if (!document) return undefined;
    const { _id, ...result } = document;
    return result;
  };
  const list = async (collection, filter = {}, sort = {}) =>
    (await collection.find(filter).sort(sort).toArray()).map(withoutMongoId);
  const maxSort = async (collection, filter = {}) =>
    (await collection.find(filter).sort({ sort_order: -1 }).limit(1).next())
      ?.sort_order + 1 || 0;
  const insert = async (name, document) => {
    const id = document.id || (await nextId(name));
    await collections[name].insertOne({ ...document, id });
    return { lastInsertRowid: id };
  };
  const bool = (value) => (value ? 1 : 0);

  return {
    async close() {
      await client.close();
    },
    async findAdmin(username) {
      return withoutMongoId(await collections.admins.findOne({ username }));
    },
    async createAdmin(username, passwordHash) {
      return insert('admins', {
        username,
        password_hash: passwordHash,
        created_at: new Date(),
      });
    },
    async getSettings() {
      return Object.fromEntries(
        (await collections.settings.find().toArray()).map((row) => [
          row.key,
          row.value,
        ]),
      );
    },
    async setSetting(key, value) {
      await collections.settings.updateOne(
        { key },
        { $set: { value } },
        { upsert: true },
      );
    },
    async categories(includeHidden = false) {
      const categories = await list(
        collections.categories,
        includeHidden ? {} : { visible: 1 },
        { sort_order: 1, id: 1 },
      );
      const counts = await collections.links
        .aggregate([{ $group: { _id: '$category_id', count: { $sum: 1 } } }])
        .toArray();
      const byId = new Map(counts.map((item) => [item._id, item.count]));
      return categories.map((category) => ({
        ...category,
        link_count: byId.get(category.id) || 0,
      }));
    },
    async category(id) {
      return withoutMongoId(await collections.categories.findOne({ id }));
    },
    async createCategory(data) {
      return insert('categories', {
        name: data.name,
        description: data.description,
        icon: data.icon,
        color: data.color,
        sort_order: await maxSort(collections.categories),
        visible: bool(data.visible),
        created_at: new Date(),
      });
    },
    async updateCategory(id, data) {
      await collections.categories.updateOne(
        { id },
        {
          $set: {
            name: data.name,
            description: data.description,
            icon: data.icon,
            color: data.color,
            visible: bool(data.visible),
          },
        },
      );
    },
    async deleteCategory(id) {
      await collections.links.deleteMany({ category_id: id });
      await collections.categories.deleteOne({ id });
    },
    async reorderCategories(ids) {
      if (ids.length)
        await collections.categories.bulkWrite(
          ids.map((id, sort_order) => ({
            updateOne: { filter: { id }, update: { $set: { sort_order } } },
          })),
        );
    },
    async links(categoryId = null, includeHidden = false) {
      const categoryFilter = includeHidden ? {} : { visible: 1 };
      const visibleCategoryIds = await collections.categories
        .find(categoryFilter, { projection: { id: 1, name: 1 } })
        .toArray();
      const categoryNames = new Map(
        visibleCategoryIds.map((item) => [item.id, item.name]),
      );
      const filter = {
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(!includeHidden
          ? { visible: 1, category_id: { $in: [...categoryNames.keys()] } }
          : {}),
      };
      const links = await list(collections.links, filter, {
        pinned: -1,
        sort_order: 1,
        id: 1,
      });
      if (includeHidden) {
        const allCategories = await collections.categories
          .find({}, { projection: { id: 1, name: 1 } })
          .toArray();
        for (const category of allCategories)
          categoryNames.set(category.id, category.name);
      }
      return links.map((link) => ({
        ...link,
        category_name: categoryNames.get(link.category_id),
      }));
    },
    async link(id) {
      return withoutMongoId(await collections.links.findOne({ id }));
    },
    async createLink(data) {
      return insert('links', {
        category_id: data.category_id,
        name: data.name,
        url: data.url,
        description: data.description,
        aliases: data.aliases || '',
        icon_type: data.icon_type,
        icon_value: data.icon_value,
        color: data.color,
        sort_order: await maxSort(collections.links, {
          category_id: data.category_id,
        }),
        pinned: bool(data.pinned),
        visible: bool(data.visible),
        health_status: 'unknown',
        health_checked_at: null,
        created_at: new Date(),
      });
    },
    async updateLink(id, data) {
      await collections.links.updateOne(
        { id },
        {
          $set: {
            category_id: data.category_id,
            name: data.name,
            url: data.url,
            description: data.description,
            aliases: data.aliases || '',
            icon_type: data.icon_type,
            icon_value: data.icon_value,
            color: data.color,
            pinned: bool(data.pinned),
            visible: bool(data.visible),
          },
        },
      );
    },
    async deleteLink(id) {
      await collections.links.deleteOne({ id });
    },
    async reorderLinks(ids) {
      if (ids.length)
        await collections.links.bulkWrite(
          ids.map((id, sort_order) => ({
            updateOne: { filter: { id }, update: { $set: { sort_order } } },
          })),
        );
    },
    async searchEngines(includeHidden = false) {
      return list(collections.search_engines, includeHidden ? {} : { visible: 1 }, {
        sort_order: 1,
        id: 1,
      });
    },
    async createSearchEngine(data) {
      return insert('search_engines', {
        name: data.name,
        query_url: data.query_url,
        icon: data.icon,
        color: data.color,
        sort_order: await maxSort(collections.search_engines),
        visible: bool(data.visible),
        created_at: new Date(),
      });
    },
    async updateSearchEngine(id, data) {
      await collections.search_engines.updateOne(
        { id },
        {
          $set: {
            name: data.name,
            query_url: data.query_url,
            icon: data.icon,
            color: data.color,
            visible: bool(data.visible),
          },
        },
      );
    },
    async deleteSearchEngine(id) {
      await collections.search_engines.deleteOne({ id });
    },
    async reorderSearchEngines(ids) {
      if (ids.length)
        await collections.search_engines.bulkWrite(
          ids.map((id, sort_order) => ({
            updateOne: { filter: { id }, update: { $set: { sort_order } } },
          })),
        );
    },
    async setLinkHealth(id, status) {
      await collections.links.updateOne(
        { id },
        { $set: { health_status: status, health_checked_at: new Date() } },
      );
    },
    async allAdmins() {
      return list(collections.admins, {}, { id: 1 });
    },
    async updateAdminPassword(username, passwordHash) {
      await collections.admins.updateOne(
        { username },
        { $set: { password_hash: passwordHash } },
      );
    },
    async recordLoginAttempt(username) {
      await insert('login_attempts', { username, attempted_at: Date.now() });
    },
    async clearLoginAttempts(username) {
      await collections.login_attempts.deleteMany({ username });
    },
    async recentLoginAttempts(username, after) {
      return collections.login_attempts.countDocuments({
        username,
        attempted_at: { $gt: after },
      });
    },
    async exportData() {
      return {
        settings: await this.getSettings(),
        categories: await list(collections.categories, {}, { sort_order: 1, id: 1 }),
        links: await list(collections.links, {}, { sort_order: 1, id: 1 }),
        searchEngines: await list(
          collections.search_engines,
          {},
          { sort_order: 1, id: 1 },
        ),
      };
    },
    async importData(payload) {
      const replaceData = async (session) => {
        const options = session ? { session } : {};
        await Promise.all(
          ['links', 'categories', 'search_engines', 'settings'].map((name) =>
            collections[name].deleteMany({}, options),
          ),
        );
        const settings = Object.entries(payload.settings || {}).map(([key, value]) => ({
          key,
          value: String(value),
        }));
        const categories = (payload.categories || []).map((c) => ({
          id: Number(c.id),
          name: c.name,
          description: c.description || '',
          icon: c.icon || '◌',
          color: c.color || '#5271ff',
          sort_order: Number(c.sort_order) || 0,
          visible: bool(c.visible),
        }));
        const links = (payload.links || []).map((l) => ({
          id: Number(l.id),
          category_id: Number(l.category_id),
          name: l.name,
          url: l.url,
          description: l.description || '',
          aliases: l.aliases || '',
          icon_type: l.icon_type || 'initial',
          icon_value: l.icon_value || '',
          color: l.color || '#5271ff',
          sort_order: Number(l.sort_order) || 0,
          pinned: bool(l.pinned),
          visible: bool(l.visible),
          health_status: l.health_status || 'unknown',
          health_checked_at: l.health_checked_at || null,
        }));
        const engines = (payload.searchEngines || []).map((e) => ({
          id: Number(e.id),
          name: e.name,
          query_url: e.query_url,
          icon: e.icon || '⌕',
          color: e.color || '#5271ff',
          sort_order: Number(e.sort_order) || 0,
          visible: bool(e.visible),
        }));
        if (settings.length) await collections.settings.insertMany(settings, options);
        if (categories.length)
          await collections.categories.insertMany(categories, options);
        if (links.length) await collections.links.insertMany(links, options);
        if (engines.length)
          await collections.search_engines.insertMany(engines, options);
        for (const [name, documents] of [
          ['categories', categories],
          ['links', links],
          ['search_engines', engines],
        ])
          await counters.updateOne(
            { _id: name },
            {
              $max: { value: Math.max(0, ...documents.map((item) => item.id)) },
            },
            { upsert: true, ...options },
          );
      };
      const hello = await db.admin().command({ hello: 1 });
      if (!hello.setName && !hello.msg?.includes('isdbgrid')) return replaceData();
      const session = client.startSession();
      try {
        await session.withTransaction(() => replaceData(session));
      } finally {
        await session.endSession();
      }
    },
  };
}
