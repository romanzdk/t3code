import { createFileRoute } from "@tanstack/react-router";

import { ThreadBoardPage } from "../components/board/ThreadBoardPage";

export const Route = createFileRoute("/_chat/board")({
  component: ThreadBoardPage,
});
