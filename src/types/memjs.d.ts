declare module "memjs" {
  export const Client: {
    create(servers: string, options?: Record<string, unknown>): {
      increment(key: string, amount: number, options: { expires: number; initial: number }, callback: (error: Error | null, success: boolean, value: number) => void): void;
      get(key: string, callback: (error: Error | null, value: Buffer | null) => void): void;
      set(key: string, value: string, options: { expires: number }, callback: (error: Error | null) => void): void;
    };
  };
  const memjs: { Client: typeof Client };
  export default memjs;
}
