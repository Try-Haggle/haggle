/**
 * Minimal type declaration for @easypost/api.
 * The package is an optional peer dependency — only required at runtime
 * when EasyPostCarrierAdapter is instantiated.
 */
declare module "@easypost/api" {
  class EasyPost {
    constructor(apiKey: string);
    Shipment: {
      create(params: Record<string, unknown>): Promise<any>;
      buy(id: string, rate: any): Promise<any>;
    };
    Tracker: {
      create(params: Record<string, unknown>): Promise<any>;
    };
  }
  export default EasyPost;
}
