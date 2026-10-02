import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsPanel } from "./workspace-panels";
import type { Connection } from "@clipstage/contracts";

const connection: Connection = {
  id: "kick",
  provider: "KICK",
  username: "streamer",
  needsReconnect: false,
};
test("healthy connections have no connect or reconnect action", () => {
  const html = renderToStaticMarkup(
    <ConnectionsPanel connections={[connection]} demo={false} />,
  );
  expect(html).toContain("Connected");
  expect(html).not.toContain("Reconnect Kick");
  expect(html).not.toContain("Connect Kick");
});
test("rejected authorizations show reconnect for the existing identity", () => {
  const html = renderToStaticMarkup(
    <ConnectionsPanel
      connections={[{ ...connection, needsReconnect: true }]}
      demo={false}
    />,
  );
  expect(html).toContain("Reconnect required");
  expect(html).toContain("Reconnect Kick");
  expect(html).not.toContain(">Connected<");
});
test("unlinked providers show connect, not reconnect", () => {
  const html = renderToStaticMarkup(
    <ConnectionsPanel connections={[]} demo={false} />,
  );
  expect(html).toContain("Connect Kick");
  expect(html).not.toContain("Reconnect Kick");
});
