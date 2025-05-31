import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import * as core from "@actions/core";

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResponse> {
  const response = await fetch("https://claude.ai/api/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export async function setupOAuthCredentials(credentials: OAuthCredentials) {
  const claudeDir = join(homedir(), ".claude");
  const credentialsPath = join(claudeDir, ".credentials.json");

  // Create the .claude directory if it doesn't exist
  await mkdir(claudeDir, { recursive: true });

  let finalCredentials = credentials;

  // Check if the access token is expired or will expire soon (within 5 minutes)
  const expiresAt = parseInt(credentials.expiresAt);
  const now = Math.floor(Date.now() / 1000);
  const bufferTime = 5 * 60; // 5 minutes buffer

  if (expiresAt <= now + bufferTime) {
    console.log("Access token is expired or will expire soon, attempting to refresh...");
    
    try {
      const refreshResponse = await refreshAccessToken(credentials.refreshToken);
      
      // Calculate new expiration time
      const newExpiresAt = now + refreshResponse.expires_in;
      
      finalCredentials = {
        accessToken: refreshResponse.access_token,
        refreshToken: refreshResponse.refresh_token,
        expiresAt: newExpiresAt.toString(),
      };

      console.log("Successfully refreshed OAuth tokens");

      // Update GitHub secrets with new tokens
      core.setSecret(finalCredentials.accessToken);
      core.setSecret(finalCredentials.refreshToken);
      
      // Output new tokens for potential GitHub secrets update
      core.setOutput("new_access_token", finalCredentials.accessToken);
      core.setOutput("new_refresh_token", finalCredentials.refreshToken);
      core.setOutput("new_expires_at", finalCredentials.expiresAt);
      
    } catch (error) {
      console.error("Failed to refresh OAuth token:", error);
      throw new Error(`OAuth token refresh failed: ${error}`);
    }
  } else {
    console.log("Access token is still valid");
  }

  // Create the credentials JSON structure
  const credentialsData = {
    claudeAiOauth: {
      accessToken: finalCredentials.accessToken,
      refreshToken: finalCredentials.refreshToken,
      expiresAt: parseInt(finalCredentials.expiresAt),
      scopes: ["user:inference", "user:profile"],
    },
  };

  // Write the credentials file
  await writeFile(credentialsPath, JSON.stringify(credentialsData, null, 2));

  console.log(`OAuth credentials written to ${credentialsPath}`);
}
