/**
 * Stub bindings — overwritten by `npm run spacetime:generate`.
 * Lets the ingestion server compile before first publish.
 */
export class DbConnection {
  static builder() {
    const b = {
      withUri(_uri: string) {
        return b;
      },
      withDatabaseName(_name: string) {
        return b;
      },
      withToken(_token: string) {
        return b;
      },
      onConnect(_fn: (conn: unknown) => void) {
        return b;
      },
      onConnectError(_fn: (ctx: unknown, err: Error) => void) {
        return b;
      },
      build() {
        throw new Error(
          'Run npm run spacetime:generate after publishing the module'
        );
      },
    };
    return b;
  }
}
