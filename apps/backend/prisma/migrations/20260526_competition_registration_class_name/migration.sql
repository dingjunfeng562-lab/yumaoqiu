-- Add a dedicated "学院班级" field so registrants can record their college/class
-- (e.g., 健康产业学院社会体育x班) separately from the school name.
ALTER TABLE `competitionregistration`
  ADD COLUMN `className` VARCHAR(120) NULL;
