const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^(0|\+84)[0-9]{9,10}$/;
const passwordRequirementChecks = {
  length: (value) => value.length >= 8 && value.length <= 16,
  uppercase: (value) => /[A-Z]/.test(value),
  lowercase: (value) => /[a-z]/.test(value),
  number: (value) => /[0-9]/.test(value),
  special: (value) => /[^A-Za-z0-9]/.test(value),
};

export const passwordRequirementLabels = {
  length: 'Từ 8 đến 16 ký tự',
  uppercase: 'Có ít nhất 1 chữ hoa',
  lowercase: 'Có ít nhất 1 chữ thường',
  number: 'Có ít nhất 1 chữ số',
  special: 'Có ít nhất 1 ký tự đặc biệt',
};

export const isEmail = (value) => emailPattern.test(value.trim());

export const isPhone = (value) => phonePattern.test(value.trim());

export const isEmailOrPhone = (value) => isEmail(value) || isPhone(value);

export const validateRequired = (value, message = 'Trường này là bắt buộc') => {
  return value?.trim() ? '' : message;
};

export const validateEmailOrPhone = (value) => {
  if (!value?.trim()) {
    return 'Vui lòng nhập email hoặc số điện thoại';
  }
  if (!isEmailOrPhone(value)) {
    return 'Email hoặc số điện thoại không hợp lệ';
  }
  return '';
};

export const validateEmail = (value) => {
  if (!value?.trim()) {
    return 'Vui lòng nhập email';
  }
  if (!isEmail(value)) {
    return 'Email không hợp lệ';
  }
  return '';
};

export const validatePhone = (value) => {
  if (!value?.trim()) {
    return 'Vui lòng nhập số điện thoại';
  }
  if (!isPhone(value)) {
    return 'Số điện thoại không hợp lệ';
  }
  return '';
};

export const validatePassword = (value) => {
  if (!value) {
    return 'Vui lòng nhập mật khẩu';
  }

  const passwordRequirements = getPasswordRequirements(value);
  const firstInvalidKey = Object.keys(passwordRequirementLabels).find(
    (key) => !passwordRequirements[key],
  );

  if (firstInvalidKey) {
    return passwordRequirementLabels[firstInvalidKey];
  }
  return '';
};

export const getPasswordRequirements = (value = '') => {
  return Object.fromEntries(
    Object.entries(passwordRequirementChecks).map(([key, check]) => [key, check(value)]),
  );
};

export const isPasswordValid = (value = '') => {
  return Object.values(getPasswordRequirements(value)).every(Boolean);
};

export const validateConfirmPassword = (value, password) => {
  if (!value) {
    return 'Vui lòng xác nhận mật khẩu';
  }
  if (value !== password) {
    return 'Mật khẩu xác nhận không khớp';
  }
  return '';
};

export const validateOtp = (value) => {
  if (!value) {
    return 'Vui lòng nhập mã OTP';
  }
  if (!/^[0-9]{6}$/.test(value)) {
    return 'Mã OTP phải gồm 6 chữ số';
  }
  return '';
};
