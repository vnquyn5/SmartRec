const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fullNamePattern = /^[A-Za-zÀ-ỹ]+(?: +[A-Za-zÀ-ỹ]+)*$/u;
const phonePattern = /^[0-9]{10}$/;
const passwordRequirementChecks = {
  length: (value) => value.length >= 8 && value.length <= 16,
  uppercase: (value) => /[A-Z]/.test(value),
  lowercase: (value) => /[a-z]/.test(value),
  number: (value) => /[0-9]/.test(value),
  special: (value) => /[^A-Za-z0-9]/.test(value),
};

export const passwordRequirementLabels = {
  length: "Từ 8 đến 16 ký tự",
  uppercase: "Có ít nhất 1 chữ hoa",
  lowercase: "Có ít nhất 1 chữ thường",
  number: "Có ít nhất 1 chữ số",
  special: "Có ít nhất 1 ký tự đặc biệt",
};

export const isEmail = (value) => emailPattern.test(value.trim());

export const isPhone = (value) => phonePattern.test(value.trim());

export const isEmailOrPhone = (value) => isEmail(value) || isPhone(value);

export const validateRequired = (value, message = "Trường này là bắt buộc") => {
  return value?.trim() ? "" : message;
};

export const formatFullName = (value = "") => {
  const lettersAndSpacesOnly = value
    .replace(/[^A-Za-zÀ-ỹ ]/gu, "")
    .replace(/ +/g, " ");

  return lettersAndSpacesOnly
    .split(" ")
    .map((word) =>
      word
        ? word.charAt(0).toLocaleUpperCase("vi-VN") +
          word.slice(1).toLocaleLowerCase("vi-VN")
        : "",
    )
    .join(" ");
};

export const validateFullName = (value) => {
  const trimmedValue = value?.trim() || "";

  if (!trimmedValue) {
    return "Vui lòng nhập họ và tên";
  }
  if (trimmedValue.length < 3 || trimmedValue.length > 50) {
    return "Họ và tên phải từ 3 đến 50 ký tự";
  }
  if (!fullNamePattern.test(trimmedValue)) {
    return "Họ và tên chỉ được chứa chữ cái và khoảng trắng";
  }
  return "";
};

export const validateEmailOrPhone = (value) => {
  if (!value?.trim()) {
    return "Vui lòng nhập email hoặc số điện thoại";
  }
  if (!isEmailOrPhone(value)) {
    return "Email hoặc số điện thoại không hợp lệ";
  }
  return "";
};

export const validateEmail = (value) => {
  const trimmedValue = value?.trim() || "";

  if (!trimmedValue) {
    return "Vui lòng nhập email";
  }
  if (trimmedValue.length < 5 || trimmedValue.length > 50) {
    return "Email phải từ 5 đến 50 ký tự";
  }
  if (!isEmail(trimmedValue)) {
    return "Email không hợp lệ";
  }
  return "";
};

export const validatePhone = (value) => {
  if (!value?.trim()) {
    return "Vui lòng nhập số điện thoại";
  }
  if (!isPhone(value)) {
    return "Số điện thoại không hợp lệ";
  }
  return "";
};

export const validatePassword = (value) => {
  if (!value) {
    return "Vui lòng nhập mật khẩu";
  }

  const passwordRequirements = getPasswordRequirements(value);
  const firstInvalidKey = Object.keys(passwordRequirementLabels).find(
    (key) => !passwordRequirements[key],
  );

  if (firstInvalidKey) {
    return passwordRequirementLabels[firstInvalidKey];
  }
  return "";
};

export const getPasswordRequirements = (value = "") => {
  return Object.fromEntries(
    Object.entries(passwordRequirementChecks).map(([key, check]) => [
      key,
      check(value),
    ]),
  );
};

export const isPasswordValid = (value = "") => {
  return Object.values(getPasswordRequirements(value)).every(Boolean);
};

export const validateConfirmPassword = (value, password) => {
  if (!value) {
    return "Vui lòng xác nhận mật khẩu";
  }
  if (value !== password) {
    return "Mật khẩu xác nhận không khớp";
  }
  return "";
};

export const validateOtp = (value) => {
  if (!value) {
    return "Vui lòng nhập mã OTP";
  }
  if (!/^[0-9]{6}$/.test(value)) {
    return "Mã OTP phải gồm 6 chữ số";
  }
  return "";
};
