// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package sandbox

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/daytonaio/daytona/cli/apiclient"
	"github.com/daytonaio/daytona/cli/cmd/common"
	"github.com/spf13/cobra"
)

const (
	labelGitBranch = "daytona.io/git-branch"
	labelGitPath   = "daytona.io/git-path"
)

var CheckoutCmd = &cobra.Command{
	Use:   "checkout [SANDBOX_ID | SANDBOX_NAME]",
	Short: "Checkout a sandbox's git branch locally",
	Long: `Fetches the git branch from a running sandbox and checks it out locally.

The sandbox must have been set up with the git bridge (daytona.io/git-branch and daytona.io/git-path labels).
The sandbox must be in a started state.

Creates a git bundle on the sandbox, streams it over SSH, and fetches locally.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()

		apiClient, err := apiclient.GetApiClient(nil, nil)
		if err != nil {
			return err
		}

		sandboxIdOrName := args[0]

		sandbox, res, err := apiClient.SandboxAPI.GetSandbox(ctx, sandboxIdOrName).Execute()
		if err != nil {
			return apiclient.HandleErrorResponse(res, err)
		}

		if err := common.RequireStartedState(sandbox); err != nil {
			return err
		}

		branch, hasBranch := sandbox.Labels[labelGitBranch]
		repoPath, hasPath := sandbox.Labels[labelGitPath]
		if !hasBranch || !hasPath {
			return fmt.Errorf("sandbox %q does not have git bridge configured.\n"+
				"Set it up in the SDK with: sandbox.gitBridge.setup({ repo, branch })", sandboxIdOrName)
		}

		absRepoPath := repoPath
		if !filepath.IsAbs(repoPath) {
			absRepoPath = filepath.Join("/home/daytona", repoPath)
		}

		sshAccessRequest := apiClient.SandboxAPI.CreateSshAccess(ctx, sandbox.Id)
		sshAccess, res, err := sshAccessRequest.ExpiresInMinutes(5).Execute()
		if err != nil {
			return apiclient.HandleErrorResponse(res, err)
		}

		host, port, err := parseSSHTarget(sshAccess.SshCommand)
		if err != nil {
			return fmt.Errorf("failed to parse SSH command: %w", err)
		}

		fmt.Printf("Fetching branch '%s' from sandbox '%s'...\n", branch, sandboxIdOrName)

		tmpBundle, err := os.CreateTemp("", "daytona-checkout-*.bundle")
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}
		defer os.Remove(tmpBundle.Name())

		bundleCmd := fmt.Sprintf("git -C %s bundle create - %s", absRepoPath, branch)
		sshArgs := []string{
			"-o", "StrictHostKeyChecking=no",
			"-o", "UserKnownHostsFile=/dev/null",
			"-o", "LogLevel=ERROR",
			"-p", port,
			host,
			bundleCmd,
		}

		sshExec := exec.Command("ssh", sshArgs...)
		sshExec.Stdout = tmpBundle
		sshExec.Stderr = os.Stderr
		sshExec.Run() // nolint:errcheck — SSH gateway may return non-zero exit despite successful transfer
		tmpBundle.Close()

		info, err := os.Stat(tmpBundle.Name())
		if err != nil || info.Size() == 0 {
			return fmt.Errorf("failed to download git bundle from sandbox (empty or missing)")
		}

		fmt.Printf("  Bundle size: %d bytes\n", info.Size())

		if err := runGit("fetch", tmpBundle.Name(), fmt.Sprintf("%s:%s", branch, branch)); err != nil {
			return fmt.Errorf("git fetch from bundle failed: %w", err)
		}

		if checkoutWorktree {
			return doWorktreeFromFetched(branch, sandboxIdOrName)
		}

		if checkoutForce {
			return runGit("checkout", "-f", branch)
		}
		return runGit("checkout", branch)
	},
}

func doWorktreeFromFetched(branch, sandboxRef string) error {
	worktreeDir := fmt.Sprintf("../%s", sandboxRef)

	if err := runGit("worktree", "add", worktreeDir, branch); err != nil {
		return fmt.Errorf("git worktree add failed: %w", err)
	}

	abs, _ := filepath.Abs(worktreeDir)
	fmt.Printf("Created worktree at '%s' on branch '%s'\n", abs, branch)
	return nil
}

func parseSSHTarget(sshCommand string) (host string, port string, err error) {
	parts := strings.Fields(sshCommand)
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid SSH command: %s", sshCommand)
	}

	port = "22"
	host = ""

	for i := 1; i < len(parts); i++ {
		if parts[i] == "-p" && i+1 < len(parts) {
			port = parts[i+1]
			i++
			continue
		}
		if strings.Contains(parts[i], "@") {
			host = parts[i]
		}
	}

	if host == "" {
		return "", "", fmt.Errorf("could not find user@host in SSH command: %s", sshCommand)
	}

	return host, port, nil
}

func runGit(args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

var (
	checkoutForce    bool
	checkoutWorktree bool
)

func init() {
	CheckoutCmd.Flags().BoolVarP(&checkoutForce, "force", "f", false, "Discard local changes when checking out")
	CheckoutCmd.Flags().BoolVarP(&checkoutWorktree, "worktree", "w", false, "Create a git worktree instead of switching branches")
}
