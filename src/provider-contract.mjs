/** Provider adapters must never assume that possession of a sharing URL implies authorization. */
export class StorageProvider {
  async authorize(_context) { throw new Error('Not implemented'); }
  async resolveFolder(_url,_credentials) { throw new Error('Not implemented'); }
  async *listFiles(_folder,_credentials) { throw new Error('Not implemented'); }
  async getMetadata(_file,_credentials) { throw new Error('Not implemented'); }
  async getDownloadStream(_file,_credentials) { throw new Error('Not implemented'); }
  async syncChanges(_cursor,_credentials) { throw new Error('Not implemented'); }
  async revoke(_credentials) { throw new Error('Not implemented'); }
}
/** No fetch of arbitrary user URLs: use the provider's SDK/API with scoped credentials. */
export const JOB_STATES = Object.freeze(['queued','authorizing','discovering','indexing','analyzing','selecting','editing','rendering','validating','completed','failed','cancelled']);
