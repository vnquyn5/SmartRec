# SmartRec

Smart Recommendation System built with Spring Boot.

## Project Structure

```
SmartRec/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/example/demo/
│   │   │       ├── DemoApplication.java
│   │   │       └── HelloController.java
│   │   └── resources/
│   └── test/
├── pom.xml
├── mvnw
├── mvnw.cmd
└── README.md
```

## Getting Started

### Prerequisites
- Java 17 or higher
- Maven 3.6+ (or use Maven Wrapper)

### Build and Run

Using Maven Wrapper:
```bash
# Linux/Mac
./mvnw clean install
./mvnw spring-boot:run

# Windows
mvnw.cmd clean install
mvnw.cmd spring-boot:run
```

### API Endpoints

- `GET /` - Welcome message

## Development

The application runs on `http://localhost:8080` by default.
