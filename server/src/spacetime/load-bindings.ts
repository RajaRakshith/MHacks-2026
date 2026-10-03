type DbConnectionStatic = {
  builder(): {
    withUri(uri: string): ReturnType<DbConnectionStatic['builder']>;
    withDatabaseName(name: string): ReturnType<DbConnectionStatic['builder']>;
    withToken(token: string): ReturnType<DbConnectionStatic['builder']>;
    onConnect(fn: (conn: unknown) => void): ReturnType<DbConnectionStatic['builder']>;
    onConnectError(fn: (ctx: unknown, err: Error) => void): ReturnType<DbConnectionStatic['builder']>;
    build(): unknown;
  };
};

/** Runtime-only load — keeps worker bindings out of this package's rootDir. */
export async function loadDbConnectionClass(): Promise<DbConnectionStatic> {
  const segments = ['..', '..', '..', 'worker', 'src', 'module_bindings', 'index.js'];
  const specifier = segments.join('/');
  const mod = (await import(specifier)) as { DbConnection: DbConnectionStatic };
  return mod.DbConnection;
}
