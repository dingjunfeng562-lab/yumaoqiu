export const PHOTO_MANAGEMENT_ACCESS = '/auth/photo-management-access';
export const PHOTO_MANAGEMENT_REVIEW_PAGE = '/nicaiyixiahh/users/photo-management-requests';

export const PHOTO_MANAGEMENT_STATUS = {
  PENDING: { label: '待审核', color: 'gold' },
  APPROVED: { label: '已开通', color: 'green' },
  REJECTED: { label: '已驳回', color: 'red' },
  REVOKED: { label: '已撤销', color: 'default' },
} as const;

export type PhotoManagementStatus = keyof typeof PHOTO_MANAGEMENT_STATUS;
export type PhotoManagementTargetType = 'TOURNAMENT' | 'ACTIVITY';

export type PhotoManagementRequest = {
  id: string;
  targetType: PhotoManagementTargetType;
  targetId: string;
  status: PhotoManagementStatus;
  purpose: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export function photoManagementTargetKey(type: PhotoManagementTargetType, id: string) {
  return `${type}:${id}`;
}

export function formatPhotoManagementDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
