import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** 把若干写法归并到一个标准校名，或标记为无效（不计入高校数）。 */
export class SaveSchoolAliasesDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请选择要归并的学校名称' })
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  names: string[];

  @IsOptional()
  @IsString()
  @MaxLength(191)
  canonical?: string;

  @IsOptional()
  @IsBoolean()
  ignored?: boolean;
}
