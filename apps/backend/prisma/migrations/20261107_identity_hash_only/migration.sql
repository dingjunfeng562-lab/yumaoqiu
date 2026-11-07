-- 身份证号改为只存带密钥的哈希：删除证件 JSON 里可还原的密文字段（encrypted）。
-- 保留 fingerprint（HMAC 哈希，用于查重）、birthDate（算年龄）、masked（打码号码，后台核对）。
-- 生产环境此前未配置证件密钥、从未写入过证件数据，执行后应为 0 行；本地/测试库可能有旧测试数据。
UPDATE `CompetitionRegistration` SET `identityData` = JSON_REMOVE(`identityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`identityData`, 'one', '$.encrypted');

UPDATE `Registration` SET `identityData` = JSON_REMOVE(`identityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`identityData`, 'one', '$.encrypted');
UPDATE `Registration` SET `partnerIdentityData` = JSON_REMOVE(`partnerIdentityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`partnerIdentityData`, 'one', '$.encrypted');

UPDATE `CompetitionRegistrationEventItem` SET `identityData` = JSON_REMOVE(`identityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`identityData`, 'one', '$.encrypted');
UPDATE `CompetitionRegistrationEventItem` SET `partnerIdentityData` = JSON_REMOVE(`partnerIdentityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`partnerIdentityData`, 'one', '$.encrypted');

UPDATE `TeamMember` SET `identityData` = JSON_REMOVE(`identityData`, '$.encrypted')
WHERE JSON_CONTAINS_PATH(`identityData`, 'one', '$.encrypted');
