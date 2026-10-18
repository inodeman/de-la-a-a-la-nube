import { createFileRoute } from "@tanstack/react-router";
import { WatchPage } from "@/documentary/WatchPage";

export const Route = createFileRoute("/")({ component: WatchPage });
