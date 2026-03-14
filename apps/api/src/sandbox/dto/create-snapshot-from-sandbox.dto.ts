/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger'
import { IsString, IsOptional, IsNumber } from 'class-validator'

@ApiSchema({ name: 'CreateSnapshotFromSandbox' })
export class CreateSnapshotFromSandboxDto {
  @ApiProperty({
    description: 'Name for the new snapshot',
  })
  @IsString()
  name: string

  @ApiPropertyOptional({
    description: 'Description of the snapshot',
  })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({
    description: 'CPU cores allocated to the resulting sandbox',
    example: 1,
    type: 'integer',
  })
  @IsOptional()
  @IsNumber()
  cpu?: number

  @ApiPropertyOptional({
    description: 'GPU units allocated to the resulting sandbox',
    example: 0,
    type: 'integer',
  })
  @IsOptional()
  @IsNumber()
  gpu?: number

  @ApiPropertyOptional({
    description: 'Memory allocated to the resulting sandbox in GB',
    example: 1,
    type: 'integer',
  })
  @IsOptional()
  @IsNumber()
  memory?: number

  @ApiPropertyOptional({
    description: 'Disk space allocated to the sandbox in GB',
    example: 3,
    type: 'integer',
  })
  @IsOptional()
  @IsNumber()
  disk?: number
}
