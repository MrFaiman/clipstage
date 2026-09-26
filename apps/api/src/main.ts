import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadEnv } from "./config";
import { ApiErrors } from "./common/errors";

const env = loadEnv();
const app = await NestFactory.create(AppModule.register(env), {
  bodyParser: false,
});
app.setGlobalPrefix("v1");
app.use(helmet());
app.use(json({ limit: "32kb" }));
app.use(cookieParser());
app.use(
  (
    _req: unknown,
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
);
app.enableCors({
  origin: env.WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
app.useGlobalFilters(new ApiErrors());
app.enableShutdownHooks();
await app.listen(env.PORT, "0.0.0.0");
