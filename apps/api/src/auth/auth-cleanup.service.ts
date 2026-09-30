import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Database } from "../common/database";

@Injectable()
export class AuthCleanupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AuthCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(Database) private readonly db: Database) {}

  async onApplicationBootstrap() {
    await this.cleanup();
    this.timer = setInterval(
      () => {
        void this.cleanup();
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async cleanup() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const [sessions, attempts] = await Promise.all([
        this.db.session.deleteMany({ where: { expiresAt: { lte: now } } }),
        this.db.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } }),
      ]);
      this.logger.log(
        `Removed ${sessions.count} expired sessions and ${attempts.count} OAuth attempts`,
      );
    } catch {
      // Do not log database errors containing connection details or credentials.
      this.logger.error(
        "Auth cleanup failed; will retry at the next scheduled run",
      );
    } finally {
      this.running = false;
    }
  }
}
