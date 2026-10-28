import { configure } from "./config";
import { BaseImageLoader } from "../adapters/images";
import { DecisionError } from "../application/errors";
class WorkerImageLoader extends BaseImageLoader {
  async remote(): Promise<never> {
    // Workers fetch cannot pin DNS resolution. Fail closed until a trusted image-fetch binding is supplied.
    throw new DecisionError(
      400,
      "remote_image_unavailable",
      "Use a base64 data URL for images on the Workers entrypoint.",
      "input",
    );
  }
}
export default {
  async fetch(request: Request, env: Record<string, string | undefined>) {
    try {
      return await configure(env, new WorkerImageLoader()).app.fetch(request);
    } catch {
      return Response.json(
        {
          error: {
            message: "Server configuration is unavailable.",
            type: "server_error",
            param: null,
            code: "configuration_error",
          },
        },
        { status: 503 },
      );
    }
  },
};
