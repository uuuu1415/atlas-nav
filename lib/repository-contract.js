export const repositoryMethods = [
  'findAdmin', 'createAdmin', 'getSettings', 'setSetting', 'categories', 'category',
  'createCategory', 'updateCategory', 'deleteCategory', 'reorderCategories', 'links',
  'link', 'createLink', 'updateLink', 'deleteLink', 'reorderLinks', 'searchEngines',
  'createSearchEngine', 'updateSearchEngine', 'deleteSearchEngine', 'reorderSearchEngines',
  'setLinkHealth', 'allAdmins', 'updateAdminPassword', 'recordLoginAttempt',
  'clearLoginAttempts', 'recentLoginAttempts', 'exportData', 'importData'
];

export function assertRepository(repository, provider) {
  const missing = repositoryMethods.filter(method => typeof repository?.[method] !== 'function');
  if (missing.length) throw new Error(`The ${provider} repository is missing methods: ${missing.join(', ')}.`);
  return repository;
}
