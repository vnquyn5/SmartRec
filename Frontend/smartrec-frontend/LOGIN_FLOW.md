# Luồng Hoạt Động Của Chức Năng Login & Redirect

Tài liệu này mô tả chi tiết cách hệ thống xử lý điều hướng (routing) khi người dùng truy cập ứng dụng, bị chặn lại bắt buộc đăng nhập, và sau đó được trả về đúng trang mà họ muốn vào ban đầu.

---

## 1. Khởi tạo ứng dụng & bọc Provider
**File:** `src/App.jsx`

Đây là điểm bắt đầu của ứng dụng React. Toàn bộ các định tuyến (Router) được đặt bên trong `AuthProvider`. Nhờ vậy, mọi trang trong ứng dụng đều có thể lấy được trạng thái đăng nhập (đã đăng nhập hay chưa).

```jsx
// Dòng 7 - 13: Bọc toàn bộ ứng dụng trong AuthProvider
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

---

## 2. Thiết lập chốt chặn bảo vệ (Router)
**File:** `src/routes/AppRoutes.jsx`

Trong file này, bạn định nghĩa các trang nào được phép vào tự do (như trang `/login`), và các trang nào (Dashboard, Upload...) cần phải đi qua chốt chặn bảo vệ.

```jsx
// Dòng 14 - 19: Phân luồng các tuyến đường
<Routes>
  {/* Trang đăng nhập cho phép truy cập tự do */}
  <Route path="/login" element={<LoginPage />} />
  
  {/* Chốt chặn RequireAuth bọc bên ngoài các trang cần bảo mật */}
  <Route element={<RequireAuth />}>
    <Route path="/" element={<DashboardPage />} />
    <Route path="/meeting/:id" element={<Meeting />} />
    <Route path="/upload" element={<UploadPage />} />
  </Route>
</Routes>
```

---

## 3. Chốt chặn bảo vệ kiểm tra trạng thái đăng nhập
**File:** `src/features/auth/RequireAuth.jsx`

Khi người dùng cố tình truy cập vào trang chủ (`/`), Component `<RequireAuth />` sẽ đứng ra kiểm tra xem tài khoản đã được xác thực chưa. Nếu chưa (`unauthenticated`), nó sẽ ép người dùng văng về trang `/login`, đồng thời "lén" mang theo cái đường dẫn (`location`) mà người dùng vừa định vào để dành cho lúc sau.

```jsx
// Dòng 6 - 8: Lấy trạng thái đăng nhập và URL hiện tại người dùng đang truy cập
const { status, hasRole } = useAuth();
const location = useLocation();

// ... 

// Dòng 17 - 19: Nếu chưa đăng nhập, đá về /login và truyền biến 'location' cũ vào state 'from'
if (status === 'unauthenticated') {
  return <Navigate to="/login" replace state={{ from: location }} />;
}
```

---

## 4. Xử lý hiển thị trang Đăng Nhập & Chuyển hướng trở lại
**File:** `src/pages/auth/LoginPage.jsx`

Trang Login hiển thị lên. Đầu tiên, nó sẽ moi móc bộ nhớ đệm (state) để tìm xem trước đó người dùng định vào trang nào (do bước 3 nhét vào). Sau khi người dùng đăng nhập thành công, nó sẽ dùng cái thông tin đó để đưa người dùng trở lại đúng nơi họ muốn.

```jsx
// Dòng 10: Tìm lại đường dẫn cũ từ state. Nếu không có (người dùng gõ thẳng /login), mặc định sẽ về trang chủ '/'
const from = location.state?.from?.pathname || '/';

// Dòng 12 - 19: Hàm xử lý khi người dùng bấm nút Đăng nhập
const handleLogin = async () => {
  try {
    // Gọi hàm đăng nhập giả lập (ở đây lưu Token)
    await login('admin@example.com', 'password123');
    
    // Đăng nhập thành công -> Điều hướng trả về đường dẫn 'from' lúc nãy
    navigate(from, { replace: true });
  } catch (err) {
    alert('Đăng nhập thất bại');
  }
};
```

---

### 💡 Tóm tắt chu trình (Ví dụ bạn muốn vào trang `/upload`):
1. Bạn gõ `http://localhost:5173/upload`.
2. `AppRoutes` thấy bạn muốn vào `/upload` nên đẩy bạn qua `RequireAuth`.
3. `RequireAuth` thấy bạn chưa Login, nó ném bạn sang `http://localhost:5173/login` kèm theo tờ giấy nhắn: *"Nhớ chuyển nó lại /upload khi xong nhé"*.
4. Màn hình `LoginPage` hiện lên, nó đọc tờ giấy nhắn và nhớ cái chữ `/upload`.
5. Bạn bấm Đăng Nhập thành công, `LoginPage` chuyển hướng bạn đi tới `/upload` y như tờ giấy dặn dò ban nãy. Hoàn hảo!
