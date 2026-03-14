// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"

	"github.com/daytonaio/runner/pkg/api/dto"
)

func (d *DockerClient) CreateSnapshotFromSandbox(ctx context.Context, containerId string, req dto.CreateSnapshotFromSandboxDTO) (*dto.SnapshotInfoResponse, error) {
	// Cancel any in-flight backup for this container
	if existing, ok := backup_context_map.Get(containerId); ok {
		existing.cancel()
		backup_context_map.Remove(containerId)
	}

	err := d.commitContainer(ctx, containerId, req.Snapshot)
	if err != nil {
		return nil, err
	}

	defer func() {
		removeErr := d.RemoveImage(context.Background(), req.Snapshot, true)
		if removeErr != nil {
			d.logger.ErrorContext(ctx, "Error removing local image after snapshot", "image", req.Snapshot, "error", removeErr)
		}
	}()

	err = d.PushImage(ctx, req.Snapshot, &req.Registry)
	if err != nil {
		return nil, err
	}

	info, err := d.GetImageInfo(ctx, req.Snapshot)
	if err != nil {
		return nil, err
	}

	return &dto.SnapshotInfoResponse{
		Name:       req.Snapshot,
		SizeGB:     float64(info.Size) / (1024 * 1024 * 1024),
		Entrypoint: info.Entrypoint,
		Cmd:        info.Cmd,
		Hash:       dto.HashWithoutPrefix(info.Hash),
	}, nil
}
