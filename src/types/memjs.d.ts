declare module "memjs" {
  export const Client: {
    create(servers: string, options?: Record<string, unknown>): {
      get(key: string, callback: (error: Error | null, value: Buffer | null) => void): void;
      set(key: string, value: string, options: { expires: number }, callback: (error: Error | null) => void): void;
    };
  };
  const memjs: { Client: typeof Client };
  export default memjs;
}
