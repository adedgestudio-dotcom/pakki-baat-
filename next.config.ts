import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  env: {
    // Freeze the deployment commit into the client bundle for release checks.
    NEXT_PUBLIC_PB_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
};

export default withWorkflow(nextConfig);
