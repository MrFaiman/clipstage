import { Controller, DynamicModule, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ENV, type Env } from "./config";
import { Database } from "./common/database";
import { Public } from "./auth/auth.types";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { AuthCleanupService } from "./auth/auth-cleanup.service";
import { AuthController } from "./auth/auth.controller";
import { KickProvider } from "./auth/kick.provider";
import { WorkspacesService } from "./workspaces/workspaces.service";
import { WorkspacesController } from "./workspaces/workspaces.controller";
import { ClipsService } from "./clips/clips.service";
import { ClipsController } from "./clips/clips.controller";
import { StorageService } from "./clips/storage.service";

@Controller("health")
class HealthController {
  @Public() @Get() health() {
    return { status: "ok", service: "clipstage-api" };
  }
}

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
      controllers: [
        HealthController,
        AuthController,
        WorkspacesController,
        ClipsController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        Database,
        AuthService,
        AuthCleanupService,
        KickProvider,
        WorkspacesService,
        ClipsService,
        StorageService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
