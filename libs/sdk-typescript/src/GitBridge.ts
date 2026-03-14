/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitStatus } from '@daytonaio/toolbox-api-client'
import { Git, GitCommitResponse } from './Git'
import { WithInstrumentation } from './utils/otel.decorator'

const LABEL_GIT_REPO = 'daytona.io/git-repo'
const LABEL_GIT_BRANCH = 'daytona.io/git-branch'
const LABEL_GIT_PATH = 'daytona.io/git-path'

/**
 * Parameters for setting up the git bridge.
 *
 * @interface
 * @property {string} repo - Remote repository URL to clone
 * @property {string} branch - Branch name to create for sandbox work
 * @property {string} [path] - Path inside the sandbox to clone into. Defaults to '.'
 * @property {string} [baseBranch] - Branch to clone from. Defaults to 'main'
 * @property {string} [username] - Git username for authentication
 * @property {string} [password] - Git password or token for authentication
 */
export interface GitBridgeSetupParams {
  repo: string
  branch: string
  path?: string
  baseBranch?: string
  username?: string
  password?: string
}

/**
 * Parameters for pushing changes through the git bridge.
 *
 * @interface
 * @property {string} [message] - Commit message. Defaults to 'sandbox: update from <sandboxId>'
 * @property {string} [author] - Commit author name. Defaults to 'Daytona Sandbox'
 * @property {string} [email] - Commit author email. Defaults to 'sandbox@daytona.io'
 * @property {string} [username] - Git username for push authentication
 * @property {string} [password] - Git password or token for push authentication
 */
export interface GitBridgePushParams {
  message?: string
  author?: string
  email?: string
  username?: string
  password?: string
}

interface SandboxLike {
  id: string
  labels: Record<string, string>
  git: Git
  setLabels(labels: Record<string, string>): Promise<Record<string, string>>
}

/**
 * Orchestrates git operations within a Sandbox and stores
 * repository metadata in sandbox labels for CLI discoverability.
 *
 * The git bridge enables the `daytona checkout` CLI command by
 * storing the repo URL, branch name, and repo path as sandbox labels.
 * This allows the CLI to fetch code directly from the sandbox over SSH
 * without needing a remote like GitHub.
 *
 * @class
 *
 * @example
 * // Set up the git bridge
 * await sandbox.gitBridge.setup({
 *   repo: 'https://github.com/user/repo.git',
 *   branch: `sandbox/${sandbox.id}`,
 *   password: process.env.GITHUB_TOKEN,
 * });
 *
 * // ... agent does work ...
 *
 * // Commit all changes (stays local in the sandbox — no push needed)
 * await sandbox.gitBridge.commit({ message: 'feat: implement OAuth2' });
 *
 * // Developer runs: daytona checkout <sandbox-id>
 * // → fetches the branch directly from the sandbox over SSH
 */
export class GitBridge {
  private repoPath: string | undefined

  constructor(private readonly sandbox: SandboxLike) {
    const existingPath = sandbox.labels[LABEL_GIT_PATH]
    if (existingPath) {
      this.repoPath = existingPath
    }
  }

  /**
   * Whether the git bridge has been set up for this sandbox.
   */
  get isConfigured(): boolean {
    return !!(this.sandbox.labels[LABEL_GIT_BRANCH] && this.sandbox.labels[LABEL_GIT_PATH])
  }

  /**
   * The branch name the sandbox is working on, or undefined if not configured.
   */
  get branch(): string | undefined {
    return this.sandbox.labels[LABEL_GIT_BRANCH]
  }

  /**
   * The repository URL, or undefined if not configured.
   */
  get repo(): string | undefined {
    return this.sandbox.labels[LABEL_GIT_REPO]
  }

  /**
   * Clones a repository, creates a working branch, and stores metadata
   * in sandbox labels so the CLI can discover and fetch this branch.
   *
   * @param {GitBridgeSetupParams} params - Setup parameters
   * @returns {Promise<void>}
   *
   * @example
   * await sandbox.gitBridge.setup({
   *   repo: 'https://github.com/user/repo.git',
   *   branch: 'sandbox/task-1',
   *   baseBranch: 'main',
   *   password: process.env.GITHUB_TOKEN,
   * });
   */
  @WithInstrumentation()
  public async setup(params: GitBridgeSetupParams): Promise<void> {
    const path = params.path ?? '.'
    const baseBranch = params.baseBranch ?? 'main'

    await this.sandbox.git.clone(params.repo, path, baseBranch, undefined, params.username, params.password)
    await this.sandbox.git.createBranch(path, params.branch)
    await this.sandbox.git.checkoutBranch(path, params.branch)

    this.repoPath = path

    await this.sandbox.setLabels({
      ...this.sandbox.labels,
      [LABEL_GIT_REPO]: params.repo,
      [LABEL_GIT_BRANCH]: params.branch,
      [LABEL_GIT_PATH]: path,
    })
  }

  /**
   * Stages all changes and creates a commit in the sandbox's local repository.
   * The commit stays local — use {@link push} if you also want to push to a remote.
   *
   * For the SSH-direct workflow (daytona checkout), committing is sufficient.
   * The CLI fetches directly from the sandbox over SSH.
   *
   * @param {GitBridgePushParams} [params] - Commit parameters
   * @returns {Promise<GitCommitResponse>} The commit SHA
   *
   * @example
   * await sandbox.gitBridge.commit({ message: 'feat: add auth module' });
   */
  @WithInstrumentation()
  public async commit(params?: GitBridgePushParams): Promise<GitCommitResponse> {
    this.requireConfigured()
    const path = this.repoPath!

    const message = params?.message ?? `sandbox: update from ${this.sandbox.id}`
    const author = params?.author ?? 'Daytona Sandbox'
    const email = params?.email ?? 'sandbox@daytona.io'

    await this.sandbox.git.add(path, ['.'])
    return await this.sandbox.git.commit(path, message, author, email)
  }

  /**
   * Stages all changes, commits, and pushes to the remote repository.
   * Use this when you want the branch available on a remote (e.g., GitHub)
   * in addition to being fetchable directly from the sandbox.
   *
   * @param {GitBridgePushParams} [params] - Commit and push parameters
   * @returns {Promise<GitCommitResponse>} The commit SHA
   *
   * @example
   * await sandbox.gitBridge.push({
   *   message: 'feat: add auth module',
   *   password: process.env.GITHUB_TOKEN,
   * });
   */
  @WithInstrumentation()
  public async push(params?: GitBridgePushParams): Promise<GitCommitResponse> {
    const result = await this.commit(params)
    await this.sandbox.git.push(this.repoPath!, params?.username, params?.password)
    return result
  }

  /**
   * Gets the current git status of the sandbox's repository.
   *
   * @returns {Promise<GitStatus>} Repository status including current branch, ahead/behind counts, and file statuses
   */
  @WithInstrumentation()
  public async status(): Promise<GitStatus> {
    this.requireConfigured()
    return await this.sandbox.git.status(this.repoPath!)
  }

  private requireConfigured(): void {
    if (!this.repoPath) {
      throw new Error(
        'Git bridge is not configured for this sandbox. Call setup() first, or ensure the sandbox has daytona.io/git-path label set.',
      )
    }
  }
}
